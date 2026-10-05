import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  refsOf,
  type SubjectErasure,
  type SubjectExport,
  type SubjectFile,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { PORTAL_FILE_CONTENT_TYPES } from './pipeline/documents.ts';
import { CONTENT_TYPES, EXTENSIONS, type VariantFormat } from './pipeline/plan.ts';
import { assets, variants } from './schema.ts';
import { type PortalFileType, portalFiles } from './schema-files.ts';
import { mediaStore } from './storage/config.ts';
import { storageKey } from './storage/port.ts';

/**
 * The person's portal uploads (M5.3a): files their portal accounts uploaded, and the photo
 * proposals and task answers of the speaker rows that are them (program resolves those).
 */
async function portalFilesTx(tx: TenantTx, s: DataSubject) {
  const uploaders = refsOf(s, 'portal_account').map((id) => `portal:${id}`);
  const owners = [...refsOf(s, 'speaker'), ...refsOf(s, 'portal_task_assignee')];
  if (uploaders.length === 0 && owners.length === 0) return [];
  return tx
    .select()
    .from(portalFiles)
    .where(
      or(
        uploaders.length ? inArray(portalFiles.createdBy, uploaders) : undefined,
        owners.length ? inArray(portalFiles.ownerId, owners) : undefined,
      ),
    )
    .orderBy(asc(portalFiles.createdAt));
}

/** The photos of the speaker rows that are the person. */
async function speakerPhotosTx(tx: TenantTx, s: DataSubject) {
  const ids = refsOf(s, 'speaker');
  if (ids.length === 0) return [];
  return tx
    .select({
      id: assets.id,
      alt: assets.alt,
      width: assets.width,
      height: assets.height,
      createdAt: assets.createdAt,
      /** U10: whose files hold the bytes (a reused library image's original). */
      storageId: sql<string>`coalesce(${assets.sourceAssetId}, ${assets.id})`,
    })
    .from(assets)
    .where(and(eq(assets.ownerType, 'speaker'), inArray(assets.ownerId, ids)))
    .orderBy(asc(assets.createdAt));
}

const safeName = (s: string) => s.replace(/[/\\]/g, '_');

/**
 * media's part of a data-subject request (M6.1c). The person's portal uploads (task answers,
 * proposed photos) and the photo of a speaker row that is them are deleted; their stored files
 * go once the erasure commits (`mediaAssets`: every object under `{org}/{id}/`). The export
 * carries the uploads as given and the speaker photo's fallback image.
 */
export const mediaDataSubjects = defineDataSubjectContributor({
  module: 'media',
  tables: {
    'media.portal_files': DELETE,
    'media.assets': DELETE,
    'media.variants': DELETE,
  },
  async export(tx, s): Promise<SubjectExport> {
    const orgId = s.orgId;
    const uploads = await portalFilesTx(tx, s);
    const photos = await speakerPhotosTx(tx, s);
    const fallbacks = photos.length
      ? await tx
          .select({ assetId: variants.assetId, format: variants.format, fileName: variants.fileName })
          .from(variants)
          .where(
            and(
              inArray(
                variants.assetId,
                photos.map((p) => p.id),
              ),
              eq(variants.fallback, true),
            ),
          )
      : [];
    const files: SubjectFile[] = [
      ...uploads.map((f) => ({
        name: safeName(`${f.id}-${f.fileName}`),
        contentType: PORTAL_FILE_CONTENT_TYPES[f.fileType as PortalFileType] ?? 'application/octet-stream',
        read: () => mediaStore().get(orgId, f.storageKey),
      })),
      ...fallbacks.map((v) => ({
        name: `speaker-photo-${v.assetId}.${EXTENSIONS[v.format as VariantFormat] ?? 'bin'}`,
        contentType: CONTENT_TYPES[v.format as VariantFormat] ?? 'application/octet-stream',
        read: () =>
          mediaStore().get(
            orgId,
            storageKey(orgId, photos.find((p) => p.id === v.assetId)?.storageId ?? v.assetId, v.fileName),
          ),
      })),
    ];
    return {
      sections: {
        portalFiles: uploads.map((f) => ({
          purpose: f.purpose,
          fileType: f.fileType,
          fileName: f.fileName,
          bytes: f.bytes,
          uploadedAt: f.createdAt,
        })),
        speakerPhotos: photos.map(({ id: _id, storageId: _s, ...p }) => p),
      },
      files,
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const uploads = await portalFilesTx(tx, s);
    const photos = await speakerPhotosTx(tx, s);
    const files = uploads.length
      ? await tx
          .delete(portalFiles)
          .where(
            inArray(
              portalFiles.id,
              uploads.map((f) => f.id),
            ),
          )
          .returning({ id: portalFiles.id })
      : [];
    // U10: the person's photo goes everywhere it is used: its original (in the library or another
    // place) and every reuse of it, reuses first (they point at the original).
    const roots = [...new Set(photos.map((p) => p.storageId))];
    const family = roots.length
      ? await tx
          .select({ id: assets.id, source: assets.sourceAssetId })
          .from(assets)
          .where(or(inArray(assets.id, roots), inArray(assets.sourceAssetId, roots)))
      : [];
    const photoIds = family.map((f) => f.id);
    const vars = photoIds.length
      ? await tx.delete(variants).where(inArray(variants.assetId, photoIds)).returning({ id: variants.id })
      : [];
    const reuses = family.filter((f) => f.source !== null).map((f) => f.id);
    const gone = [
      ...(reuses.length
        ? await tx.delete(assets).where(inArray(assets.id, reuses)).returning({ id: assets.id })
        : []),
      ...(roots.length
        ? await tx.delete(assets).where(inArray(assets.id, roots)).returning({ id: assets.id })
        : []),
    ];
    return {
      erased: {
        'media.portal_files': files.length,
        'media.assets': gone.length,
        'media.variants': vars.length,
      },
      mediaAssets: [...files.map((f) => f.id), ...gone.map((a) => a.id)],
    };
  },
});
