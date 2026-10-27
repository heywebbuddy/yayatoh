import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { bigint, check, index, text, uuid } from 'drizzle-orm/pg-core';
import { mediaSchema } from './schema.ts';

/**
 * Public PDF attachments (brochures, spec sheets) of a sponsor or an exhibitor. Stored as
 * uploaded (type sniffed from the bytes, size capped) in the media store as
 * `{org}/{doc}/f-{hash}.pdf`, and served through `/api/program-docs/{org}/{doc}/{file}` under the
 * same visibility rules as the owner's images (`media.owner_visibility`).
 */
export const PROGRAM_DOC_OWNERS = ['sponsor', 'exhibitor'] as const;
export const PROGRAM_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS_PER_OWNER = 5;

export const programDocuments = tenantTable(
  mediaSchema,
  'program_documents',
  {
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    index('program_documents_org_owner_idx').on(t.orgId, t.ownerType, t.ownerId),
    check('program_documents_owner_type_check', sql`owner_type in ('sponsor', 'exhibitor')`),
    check('program_documents_title_check', sql`char_length(title) between 1 and 120`),
    check('program_documents_name_check', sql`char_length(file_name) between 1 and 200`),
    check(
      'program_documents_key_check',
      sql`starts_with(storage_key, org_id::text || '/' || id::text || '/f-')`,
    ),
    check('program_documents_sha_check', sql`sha256 ~ '^[0-9a-f]{64}$'`),
    check('program_documents_bytes_check', sql`bytes between 1 and 10485760`),
  ],
);
