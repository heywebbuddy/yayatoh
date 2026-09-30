import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { and, eq, like } from 'drizzle-orm';
import { blobs } from '../schema.ts';
import { assertOrgKey, assetPrefix, type MediaStore } from './port.ts';

const ctxFor = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'media-store' } });

/**
 * The development / CI adapter: objects are rows in `media.blobs`, read and written in their own
 * short transaction under the org's row-level security (like a remote object store, it is not
 * part of the caller's transaction).
 */
export function postgresMediaStore(): MediaStore {
  return {
    kind: 'postgres',
    async put(orgId, key, bytes, contentType) {
      assertOrgKey(orgId, key);
      await withTenant(ctxFor(orgId), (tx) =>
        tx
          .insert(blobs)
          .values({ orgId, key, contentType, data: bytes })
          .onConflictDoUpdate({ target: [blobs.orgId, blobs.key], set: { contentType, data: bytes } }),
      );
    },
    async get(orgId, key) {
      assertOrgKey(orgId, key);
      const [row] = await withTenant(ctxFor(orgId), (tx) =>
        tx.select({ data: blobs.data }).from(blobs).where(eq(blobs.key, key)),
      );
      return row ? row.data : null;
    },
    async deleteAsset(orgId, assetId) {
      const prefix = assetPrefix(orgId, assetId);
      await withTenant(ctxFor(orgId), (tx) =>
        tx.delete(blobs).where(and(eq(blobs.orgId, orgId), like(blobs.key, `${prefix}%`))),
      );
    },
  };
}
