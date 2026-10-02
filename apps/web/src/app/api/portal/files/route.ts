import { isDomainError } from '@yayatoh/kernel';
import { PORTAL_FILE_MAX_BYTES, uploadSpeakerPortalFile } from '@yayatoh/media';
import { currentPortalPrincipal, portalRequestCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';

/** Room for the multipart envelope and the text fields around the file. */
const ENVELOPE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const refuse = (status: number, code: string, reason?: string) =>
  json(status, { ok: false, code, ...(reason ? { reason } : {}) });

/**
 * Portal file upload (M5.3a): `multipart/form-data` with `purpose` (`task_answer` or
 * `speaker_photo`), `assigneeId` (task answers) and `file`, from a signed-in portal session. The
 * size is capped before the body is read; the media command sniffs the bytes, checks the task or
 * profile is the speaker's own and completes the task or attaches the photo for approval.
 */
export async function POST(req: Request): Promise<Response> {
  const length = Number(req.headers.get('content-length') ?? 'NaN');
  if (!Number.isFinite(length)) return refuse(411, 'length_required');
  if (length > PORTAL_FILE_MAX_BYTES + ENVELOPE_BYTES) return refuse(413, 'validation_failed', 'too_large');
  if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data'))
    return refuse(415, 'validation_failed', 'unsupported_type');
  const principal = await currentPortalPrincipal();
  if (!principal) return refuse(401, 'unauthenticated');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse(400, 'validation_failed', 'undecodable');
  }
  const purpose = String(form.get('purpose') ?? '');
  if (purpose !== 'task_answer' && purpose !== 'speaker_photo') return refuse(400, 'validation_failed');
  const assigneeId = String(form.get('assigneeId') ?? '') || null;
  if (assigneeId !== null && !UUID.test(assigneeId)) return refuse(404, 'not_found');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return refuse(400, 'validation_failed', 'no_file');
  if (file.size > PORTAL_FILE_MAX_BYTES) return refuse(413, 'validation_failed', 'too_large');
  try {
    const r = await uploadSpeakerPortalFile(
      await portalRequestCtx(principal),
      { purpose, assigneeId, file: new Uint8Array(await file.arrayBuffer()), fileName: file.name },
      ports,
    );
    return json(200, { ok: true, fileName: r.fileName });
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    return refuse(err.status, err.code, typeof reason === 'string' ? reason : undefined);
  }
}
