import { createHash, randomUUID } from 'node:crypto';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError, executeCommand, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { programOwnerTx } from '@yayatoh/program';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cleanFileName } from './pipeline/documents.ts';
import {
  MAX_DOCS_PER_OWNER,
  PROGRAM_DOC_MAX_BYTES,
  PROGRAM_DOC_OWNERS,
  programDocuments,
} from './schema-docs.ts';
import { mediaStore } from './storage/config.ts';
import { storageKey } from './storage/port.ts';

export const ProgramDocumentDto = z.object({
  id: z.uuid(),
  ownerType: z.enum(PROGRAM_DOC_OWNERS),
  ownerId: z.uuid(),
  title: z.string(),
  fileName: z.string(),
  bytes: z.number().int(),
  /** Relative download URL (served by the web app). */
  href: z.string(),
});
export type ProgramDocumentDto = z.infer<typeof ProgramDocumentDto>;

const hrefOf = (orgId: string, id: string, fileName: string) =>
  `/api/program-docs/${orgId}/${id}/${encodeURIComponent(fileName)}`;

const dtoOf = (r: typeof programDocuments.$inferSelect): ProgramDocumentDto => ({
  id: r.id,
  ownerType: r.ownerType as ProgramDocumentDto['ownerType'],
  ownerId: r.ownerId,
  title: r.title,
  fileName: r.fileName,
  bytes: r.bytes,
  href: hrefOf(r.orgId, r.id, r.fileName),
});

const isPdf = (b: Uint8Array) =>
  b.length >= 5 && String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0, b[4] ?? 0) === '%PDF-';

const reject = (reason: string) =>
  new DomainError('validation_failed', 'The file was refused', { field: 'file', reason });

export const UploadProgramDocumentInput = z.object({
  /** Chosen by the server wrapper, so a failed upload's object can be purged. */
  documentId: z.uuid(),
  ownerType: z.enum(PROGRAM_DOC_OWNERS),
  ownerId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  file: z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'must be the file bytes'),
  fileName: z.string().max(500).default(''),
});
export type UploadProgramDocumentInput = z.input<typeof UploadProgramDocumentInput>;

export const uploadProgramDocumentCommand = tenantCommand({
  name: 'media.uploadProgramDocument',
  input: UploadProgramDocumentInput,
  output: ProgramDocumentDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (!(await programOwnerTx(tx, input.ownerType, input.ownerId))) throw new DomainError('not_found');
    const bytes = input.file;
    if (bytes.byteLength === 0) throw reject('no_file');
    if (bytes.byteLength > PROGRAM_DOC_MAX_BYTES) throw reject('too_large');
    if (!isPdf(bytes)) throw reject('unsupported_type');
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(programDocuments)
      .where(
        and(eq(programDocuments.ownerType, input.ownerType), eq(programDocuments.ownerId, input.ownerId)),
      );
    if (n >= MAX_DOCS_PER_OWNER)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = cleanFileName(input.fileName, 'pdf');
    const key = storageKey(orgId, input.documentId, `f-${sha256.slice(0, 32)}.pdf`);
    await mediaStore().put(orgId, key, bytes, 'application/pdf');
    const [row] = await tx
      .insert(programDocuments)
      .values({
        id: input.documentId,
        orgId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        title: input.title,
        fileName,
        storageKey: key,
        sha256,
        bytes: bytes.byteLength,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return dtoOf(row);
  },
  audit: (input, r) => ({
    action: 'media.program_document.upload',
    targetType: input.ownerType,
    targetId: input.ownerId,
    data: { documentId: r.id, bytes: r.bytes },
  }),
});

/** Upload a brochure: the server picks the id and purges the object when the command fails. */
export async function uploadProgramDocument(
  ctx: Ctx,
  input: Omit<UploadProgramDocumentInput, 'documentId'>,
  ports: CommandPorts<TenantTx>,
): Promise<ProgramDocumentDto> {
  const documentId = randomUUID();
  try {
    return await executeCommand(uploadProgramDocumentCommand, { ...input, documentId }, ctx, ports);
  } catch (err) {
    await mediaStore()
      .deleteAsset(requireOrg(ctx), documentId)
      .catch(() => undefined);
    throw err;
  }
}

export const deleteProgramDocumentCommand = tenantCommand({
  name: 'media.deleteProgramDocument',
  category: 'delete',
  input: z.object({ documentId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .delete(programDocuments)
      .where(eq(programDocuments.id, input.documentId))
      .returning({ id: programDocuments.id });
    if (rows.length === 0) throw new DomainError('not_found');
    // Rows first, then the object (the store is idempotent).
    await mediaStore().deleteAsset(requireOrg(ctx), input.documentId);
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'media.program_document.delete',
    targetType: 'program_document',
    targetId: input.documentId,
  }),
});

/** The organizer's list: attachments of the given owners. */
export const programDocumentsQuery = tenantQuery({
  name: 'media.programDocuments',
  input: z.object({ ownerType: z.enum(PROGRAM_DOC_OWNERS), ownerIds: z.array(z.uuid()).max(500) }),
  output: z.array(ProgramDocumentDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    if (input.ownerIds.length === 0) return [];
    const rows = await tx
      .select()
      .from(programDocuments)
      .where(eq(programDocuments.ownerType, input.ownerType))
      .orderBy(asc(programDocuments.createdAt));
    const wanted = new Set(input.ownerIds);
    return rows.filter((r) => wanted.has(r.ownerId)).map(dtoOf);
  },
});

type DocRow = {
  id: string;
  owner_type: string;
  owner_id: string;
  title: string;
  file_name: string;
  bytes: number | string;
};

/** The attachments of one owner on a public page (the caller already resolved the page's event). */
export async function publicProgramDocuments(
  orgId: string,
  ownerType: (typeof PROGRAM_DOC_OWNERS)[number],
  ownerId: string,
  opts: { privateOk?: boolean } = {},
): Promise<ProgramDocumentDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<DocRow>(
      sql`select * from media.public_program_documents(${orgId}::uuid, ${ownerType}, ${ownerId}::uuid, ${opts.privateOk === true})`,
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    ownerType,
    ownerId: r.owner_id,
    title: r.title,
    fileName: r.file_name,
    bytes: Number(r.bytes),
    href: hrefOf(orgId, r.id, r.file_name),
  }));
}

export type DocumentTarget = {
  fileName: string;
  storageKey: string;
  sha256: string;
  bytes: number;
  visibility: 'public' | 'private_event' | 'none';
  eventId: string | null;
};

/** What a download request points at (no bytes), or null. */
export async function documentTarget(orgId: string, documentId: string): Promise<DocumentTarget | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{
      file_name: string;
      storage_key: string;
      sha256: string;
      bytes: number | string;
      visibility: DocumentTarget['visibility'];
      event_id: string | null;
    }>(sql`select * from media.program_document_target(${orgId}::uuid, ${documentId}::uuid)`),
  );
  const r = rows[0];
  return r
    ? {
        fileName: r.file_name,
        storageKey: r.storage_key,
        sha256: r.sha256,
        bytes: Number(r.bytes),
        visibility: r.visibility,
        eventId: r.event_id,
      }
    : null;
}

export const readDocument = (orgId: string, key: string) => mediaStore().get(orgId, key);

/** Used by the cleanup subscriber when a program owner is deleted. */
export async function purgeOwnerDocumentsTx(
  tx: TenantTx,
  ownerType: string,
  ownerId: string,
): Promise<string[]> {
  const rows = await tx
    .delete(programDocuments)
    .where(and(eq(programDocuments.ownerType, ownerType), eq(programDocuments.ownerId, ownerId)))
    .returning({ id: programDocuments.id });
  return rows.map((r) => r.id);
}
