import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { CONTENT_TYPES, mediaStore, type VariantFormat } from '@yayatoh/media';
import { appTokenSecret } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { type DirectUpload, verifyDirectUpload, verifyFile } from './domain/tokens.ts';
import { variants } from './schema.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^[0-9]{1,5}-[0-9a-f]{32}\.(avif|webp|jpg|png)$/;

/**
 * A photo file for a signed URL (M4.5b): the signature must be valid and unexpired, and the file
 * must still belong to an item (a removed or rejected photo is gone at once, whatever URL a
 * browser kept). The org comes from the signed path, never from a header.
 */
export async function readGalleryFile(
  orgId: string,
  itemId: string,
  fileName: string,
  e: string | null,
  s: string | null,
  now = new Date(),
): Promise<{ bytes: Uint8Array; contentType: string; sha256: string } | null> {
  if (!UUID.test(orgId) || !UUID.test(itemId) || !FILE.test(fileName)) return null;
  if (!verifyFile(orgId, itemId, fileName, e, s, now, appTokenSecret())) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'gallery.file' } });
  const [v] = await withTenant(ctx, (tx) =>
    tx
      .select({ format: variants.format, sha256: variants.sha256 })
      .from(variants)
      .where(and(eq(variants.itemId, itemId), eq(variants.fileName, fileName))),
  );
  if (!v) return null;
  const bytes = await mediaStore().get(orgId, `${orgId}/${itemId}/${fileName}`);
  if (!bytes) return null;
  return { bytes, contentType: CONTENT_TYPES[v.format as VariantFormat], sha256: v.sha256 };
}

/**
 * The dev/CI stand-in for a presigned PUT: the token names the org, the staging key and the exact
 * size; the bytes are stored as they arrived, unread (they are sniffed when the upload completes).
 */
export function directUploadTarget(token: string, now = new Date()): DirectUpload | null {
  const d = verifyDirectUpload(token, now, appTokenSecret());
  if (!d || !UUID.test(d.orgId) || !d.key.startsWith(`${d.orgId}/`)) return null;
  return d;
}

export async function storeDirectUpload(d: DirectUpload, bytes: Uint8Array): Promise<boolean> {
  if (bytes.byteLength !== d.bytes) return false;
  await mediaStore().put(d.orgId, d.key, bytes, 'application/octet-stream');
  return true;
}
