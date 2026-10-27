import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { POSTER_MAX_BYTES, storeVideo, videoMaxBytes } from '@yayatoh/media';
import { resolveOrgSlug, roleCan } from '@yayatoh/tenancy';
import { orgActor } from '@/server/org-actor.ts';
import { getSession } from '@/server/session.ts';

const run = promisify(execFile);
const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** A poster frame from the video when `ffmpeg` is installed; otherwise null (the poster is required). */
async function frame(video: Uint8Array): Promise<Uint8Array | null> {
  const dir = await mkdtemp(join(tmpdir(), 'yy-video-'));
  try {
    await writeFile(join(dir, 'in'), video);
    await run('ffmpeg', ['-y', '-ss', '1', '-i', join(dir, 'in'), '-frames:v', '1', '-q:v', '3', join(dir, 'out.jpg')], {
      timeout: 30_000,
    });
    return new Uint8Array(await readFile(join(dir, 'out.jpg')));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Upload a video (MP4 or WebM) and its poster to the org's media storage:
 * `multipart/form-data` with `org` (slug), `video` and an optional `poster` image. The caller must
 * be able to edit events in that org. Answers `{ ok, url, poster }` (storage paths) or `{ ok: false, code }`.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return reply(401, { ok: false, code: 'unauthorized' });
  const max = videoMaxBytes();
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > max + POSTER_MAX_BYTES + 64 * 1024) return reply(413, { ok: false, code: 'too_large' });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply(400, { ok: false, code: 'invalid' });
  }
  const slug = String(form.get('org') ?? '');
  const org = slug ? await resolveOrgSlug(slug) : null;
  const actor = org ? await orgActor(org.orgId, session) : null;
  if (!org || !actor || !roleCan(actor.role, 'events:write')) return reply(404, { ok: false, code: 'not_found' });
  const video = form.get('video');
  const poster = form.get('poster');
  if (!(video instanceof File) || video.size === 0) return reply(400, { ok: false, code: 'unsupported' });
  const res = await storeVideo(org.orgId, {
    video: new Uint8Array(await video.arrayBuffer()),
    poster: poster instanceof File && poster.size > 0 ? new Uint8Array(await poster.arrayBuffer()) : null,
    framePoster: frame,
  });
  if (!res.ok) return reply(res.error === 'too_large' ? 413 : 400, { ok: false, code: res.error });
  return reply(200, { ok: true, url: res.value.videoPath, poster: res.value.posterPath });
}
