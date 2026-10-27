import { isDomainError } from '@yayatoh/kernel';
import { PROGRAM_DOC_MAX_BYTES, PROGRAM_DOC_OWNERS, uploadProgramDocument } from '@yayatoh/media';
import { orgActor } from '@/server/org-actor.ts';
import { ports } from '@/server/ports.ts';
import { getSession } from '@/server/session.ts';

/** Room for the multipart envelope and the text fields around the file. */
const ENVELOPE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const refuse = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { ok: false, code, ...extra });

/**
 * Brochure upload for a sponsor or an exhibitor: `multipart/form-data` with `orgId`, `ownerType`,
 * `ownerId`, `title` and `file` (a PDF). The size is capped before the body is read; the media
 * command checks the bytes and that the signed-in member may write events.
 */
export async function POST(req: Request): Promise<Response> {
  const length = Number(req.headers.get('content-length') ?? 'NaN');
  if (!Number.isFinite(length)) return refuse(411, 'length_required');
  if (length > PROGRAM_DOC_MAX_BYTES + ENVELOPE_BYTES)
    return refuse(413, 'validation_failed', { reason: 'too_large' });
  if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data'))
    return refuse(415, 'validation_failed', { reason: 'unsupported_type' });
  const session = await getSession();
  if (!session) return refuse(401, 'unauthenticated');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse(400, 'validation_failed', { reason: 'undecodable' });
  }
  const orgId = String(form.get('orgId') ?? '');
  const ownerId = String(form.get('ownerId') ?? '');
  const ownerType = String(form.get('ownerType') ?? '');
  const file = form.get('file');
  if (
    !UUID.test(orgId) ||
    !UUID.test(ownerId) ||
    !(PROGRAM_DOC_OWNERS as readonly string[]).includes(ownerType)
  )
    return refuse(400, 'validation_failed');
  if (!(file instanceof File) || file.size === 0)
    return refuse(400, 'validation_failed', { fields: ['file'], reason: 'no_file' });
  if (file.size > PROGRAM_DOC_MAX_BYTES)
    return refuse(413, 'validation_failed', { fields: ['file'], reason: 'too_large' });
  const actor = await orgActor(orgId, session, { locale: String(form.get('locale') ?? 'en') });
  if (!actor) return refuse(403, 'forbidden');
  try {
    const doc = await uploadProgramDocument(
      actor.ctx,
      {
        ownerType: ownerType as (typeof PROGRAM_DOC_OWNERS)[number],
        ownerId,
        title: String(form.get('title') ?? '').trim() || file.name.replace(/\.pdf$/i, ''),
        file: new Uint8Array(await file.arrayBuffer()),
        fileName: file.name,
      },
      ports,
    );
    return json(200, { ok: true, id: doc.id });
  } catch (err) {
    if (isDomainError(err)) {
      const details = err.details as { reason?: string; field?: string } | undefined;
      return refuse(err.code === 'forbidden' ? 403 : err.code === 'not_found' ? 404 : 422, err.code, {
        reason: details?.reason,
        fields: details?.field ? [details.field] : [],
      });
    }
    throw err;
  }
}
