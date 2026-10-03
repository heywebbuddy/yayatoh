/**
 * Where media files live (M1.4e). Two adapters:
 * - `postgres` (dev, preview and CI): objects in `media.blobs`, under the org's row-level security;
 * - `r2` (production, once the owner's Cloudflare account exists): S3-compatible API.
 *
 * Every key starts with the org id (`{org}/{asset}/{file}`) and every call names the org, so an
 * adapter can never be asked for another org's object by a mistyped key.
 */
export interface MediaStore {
  readonly kind: 'postgres' | 'r2';
  put(orgId: string, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(orgId: string, key: string): Promise<Uint8Array | null>;
  /** Delete every object under `{org}/{asset}/` (an asset's variants). */
  deleteAsset(orgId: string, assetId: string): Promise<void>;
  /**
   * M4.5b: a presigned PUT for one object of exactly `bytes` bytes, so a browser uploads straight
   * to the store. Only stores that can sign one (R2) implement it; the app's own direct-upload
   * route stands in for the others (dev and CI).
   */
  presignPut?(
    orgId: string,
    key: string,
    opts: { readonly bytes: number; readonly expiresInSeconds: number },
  ): { readonly url: string; readonly headers: Readonly<Record<string, string>> };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Refuse any key outside the org's prefix, or with path tricks. */
export function assertOrgKey(orgId: string, key: string): void {
  if (!UUID.test(orgId)) throw new Error('media store: bad org id');
  const parts = key.split('/');
  if (
    parts.length !== 3 ||
    parts[0] !== orgId ||
    !UUID.test(parts[1] ?? '') ||
    !(
      /^[0-9]{1,5}-[0-9a-f]{32}\.(avif|webp|jpg|png|svg|pdf)$/.test(parts[2] ?? '') ||
      // M5.5a badge PDFs share the first form (`{n}-{hash}.pdf`); M5.3a portal files (as uploaded): `f-{hash}.{ext}`.
      /^f-[0-9a-f]{32}\.(pdf|pptx|docx|jpg|png|webp)$/.test(parts[2] ?? '') ||
      // M4.5b: a gallery upload as the browser sent it, before it is sniffed and re-encoded.
      /^u-[0-9a-f]{32}$/.test(parts[2] ?? '')
    )
  )
    throw new Error('media store: key outside the org prefix');
}

export function assetPrefix(orgId: string, assetId: string): string {
  if (!UUID.test(orgId) || !UUID.test(assetId)) throw new Error('media store: bad asset prefix');
  return `${orgId}/${assetId}/`;
}

export const storageKey = (orgId: string, assetId: string, fileName: string) =>
  `${assetPrefix(orgId, assetId)}${fileName}`;
