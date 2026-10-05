import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { bigint, check, index, text, uuid } from 'drizzle-orm/pg-core';
import { mediaSchema } from './schema.ts';

/**
 * M5.3a portal files: what speakers (and, from M5.4, exhibitors) upload through the portal — a
 * task's answer ("upload slides": PDF, PowerPoint, Word or an image) and a proposed speaker photo
 * awaiting the organizer's approval. Stored as uploaded (type sniffed, size capped) under
 * `{org}/{file}/f-{hash}.{ext}` in the media store; never public. Only organizers download them.
 */
export const PORTAL_FILE_PURPOSES = ['task_answer', 'speaker_photo'] as const;
export type PortalFilePurpose = (typeof PORTAL_FILE_PURPOSES)[number];
export const PORTAL_FILE_TYPES = ['pdf', 'pptx', 'docx', 'jpeg', 'png', 'webp'] as const;
export type PortalFileType = (typeof PORTAL_FILE_TYPES)[number];

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const portalFiles = tenantTable(
  mediaSchema,
  'portal_files',
  {
    purpose: text('purpose').notNull(),
    /** The program row it belongs to (task assignee or speaker; a lower tier's ids, no FK). */
    ownerId: uuid('owner_id').notNull(),
    fileType: text('file_type').notNull(),
    /** The uploader's file name, cleaned for display and downloads. */
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    /** `portal:{account}` of the uploader. */
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    index('portal_files_org_owner_idx').on(t.orgId, t.ownerId),
    check('portal_files_purpose_check', inList('purpose', PORTAL_FILE_PURPOSES)),
    check('portal_files_type_check', inList('file_type', PORTAL_FILE_TYPES)),
    check('portal_files_name_check', sql`char_length(file_name) between 1 and 200`),
    check('portal_files_key_check', sql`starts_with(storage_key, org_id::text || '/' || id::text || '/f-')`),
    check('portal_files_sha_check', sql`sha256 ~ '^[0-9a-f]{64}$'`),
    check('portal_files_bytes_check', sql`bytes between 1 and 26214400`),
  ],
);
