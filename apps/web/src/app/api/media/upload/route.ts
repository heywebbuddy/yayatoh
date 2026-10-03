import { createCtx, isDomainError } from '@yayatoh/kernel';
import {
  isProgramOwner,
  MAX_UPLOAD_BYTES,
  uploadLogo,
  uploadMedia,
  uploadProgramImage,
  verifyUploadTicket,
} from '@yayatoh/media';
import { revalidatePath } from 'next/cache';
import { ports } from '@/server/ports.ts';
import { getSession, sessionOpensOrg } from '@/server/session.ts';

/** Room for the multipart envelope and the text fields around the file. */
const ENVELOPE_BYTES = 64 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const refuse = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { ok: false, code, ...extra });

/**
 * Image upload (M1.4e): `multipart/form-data` with `ticket` (signed by the console page for this
 * user, org, owner and slot), `file`, `alt`, `decorative` and optionally `replaceAssetId`.
 * The size is capped before the body is read; the bytes are sniffed and re-encoded by the media
 * command, which also authorizes the upload (the ticket alone never grants anything).
 */
export async function POST(req: Request): Promise<Response> {
  const length = Number(req.headers.get('content-length') ?? 'NaN');
  if (!Number.isFinite(length)) return refuse(411, 'length_required');
  if (length > MAX_UPLOAD_BYTES + ENVELOPE_BYTES)
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
  const ticket = verifyUploadTicket(String(form.get('ticket') ?? ''));
  if (!ticket || ticket.userId !== session.userId) return refuse(403, 'forbidden');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0)
    return refuse(400, 'validation_failed', { fields: ['file'], reason: 'no_file' });
  if (file.size > MAX_UPLOAD_BYTES)
    return refuse(413, 'validation_failed', { fields: ['file'], reason: 'too_large' });

  const alt = String(form.get('alt') ?? '').trim() || null;
  const decorative = form.get('decorative') === '1';
  const replace = String(form.get('replaceAssetId') ?? '').trim() || null;
  // Staff acting as a member (M1.2e) work in that org only, and every write names them.
  const imp = session.impersonation;
  if (imp && imp.orgId !== ticket.orgId) return refuse(403, 'forbidden');
  // M6.5a: a session made by an org's single sign-on opens that org only.
  if (!sessionOpensOrg(session, ticket.orgId)) return refuse(403, 'forbidden');
  const ctx = createCtx({
    orgId: ticket.orgId,
    actor: { type: 'user', userId: session.userId },
    locale: String(form.get('locale') ?? 'en'),
    impersonatedBy: imp ? { staffUserId: imp.staffUserId, impersonationId: imp.id } : null,
  });
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const owner = ticket.ownerType;
    const result =
      owner === 'org'
        ? await uploadLogo(ctx, { alt, file: bytes, replaceAssetId: replace }, ports)
        : isProgramOwner(owner)
          ? // M1.4h: speaker photos, exhibitor and sponsor logos (never decorative).
            await uploadProgramImage(
              ctx,
              owner,
              { ownerId: ticket.ownerId, alt, file: bytes, replaceAssetId: replace },
              ports,
            )
          : await uploadMedia(
              ctx,
              {
                ownerType: owner,
                ownerId: ticket.ownerId,
                slot: ticket.slot as 'cover' | 'gallery' | 'photo' | 'floorplan',
                alt,
                decorative,
                file: bytes,
                replaceAssetId: replace,
              },
              ports,
            );
    // Console pages render per request; the org layout (header logo) and public pages follow.
    revalidatePath('/', 'layout');
    // A floor plan image (M1.7g) goes under the seating plan: the editor needs its size and file.
    const plan =
      result.asset.slot === 'floorplan'
        ? {
            width: result.asset.width,
            height: result.asset.height,
            url: (
              result.asset.variants.filter((v) => v.format === 'webp').sort((a, b) => b.width - a.width)[0] ??
              result.asset.variants.find((v) => v.fallback) ??
              result.asset.variants[0]
            )?.url,
          }
        : {};
    return json(200, { ok: true, assetId: result.asset.id, replaced: result.replacedAssetId, ...plan });
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const details = (err.details ?? {}) as { issues?: { path: string }[]; field?: unknown; reason?: unknown };
    const fields = new Set<string>();
    for (const i of details.issues ?? []) fields.add(i.path.split('.')[0] ?? '');
    if (typeof details.field === 'string') fields.add(details.field);
    return refuse(err.status, err.code, {
      fields: [...fields].filter(Boolean),
      ...(typeof details.reason === 'string' ? { reason: details.reason } : {}),
    });
  }
}
