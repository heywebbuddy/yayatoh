import { directUploadTarget, storeDirectUpload } from '@yayatoh/gallery';
import { mediaStore } from '@yayatoh/media';

const refuse = (status: number, code: string) =>
  Response.json({ ok: false, code }, { status, headers: { 'cache-control': 'no-store' } });

/**
 * The dev/CI stand-in for a presigned PUT to R2 (M4.5b): the browser sends a gallery photo
 * straight here with the slot's token, which names the org, the staging key and the exact size.
 * The bytes are stored as they are, unread; they are sniffed and re-encoded when the upload
 * completes. Production uses R2's own presigned URL instead (the store signs it), so this route
 * refuses when the store can sign.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (mediaStore().presignPut) return refuse(404, 'not_found');
  const { token } = await params;
  const target = directUploadTarget(decodeURIComponent(token));
  if (!target) return refuse(403, 'forbidden');
  const length = Number(req.headers.get('content-length') ?? 'NaN');
  if (!Number.isFinite(length)) return refuse(411, 'length_required');
  if (length !== target.bytes) return refuse(400, 'size_mismatch');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!(await storeDirectUpload(target, bytes))) return refuse(400, 'size_mismatch');
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}
