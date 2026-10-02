import { createHash } from 'node:crypto';
import { normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { mediaStore } from '@yayatoh/media';
import {
  erasureConnectorHooks,
  keyVault,
  markAddressErasedTx,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { buildArchive } from './archive.ts';
import { DsarEmail, DsarSummary, maskEmail, subjectRefOf } from './dsar.ts';
import { RECEIPT_FORMAT, Receipt, signReceipt } from './receipt.ts';
import { DSAR_KINDS, DSAR_SOURCES, DSAR_STATUSES, dsarRequests } from './schema.ts';
import { dsarSigner } from './signing.ts';
import {
  collectSubjectExportTx,
  eraseSubjectEverywhereTx,
  resolveDataSubjectTx,
  summarizeExport,
} from './subject.ts';

/**
 * The data-subject request lifecycle (M6.1c). One open request per person per org, opened by
 * staff (on the person's behalf) or by the person after proving the address (self-service). Due
 * 30 days after it is opened (GDPR Art. 12(3)). An access request is fulfilled with a signed ZIP
 * (7 days to download); an erasure with a signed receipt. While open, the address is kept sealed
 * with the org's key vault; it is cleared when the request closes.
 */

const DAY = 86_400_000;
export const DSAR_DUE_DAYS = 30;
export const DSAR_ARCHIVE_DAYS = 7;

const enc = new TextEncoder();

async function sealEmail(orgId: string, email: string): Promise<string> {
  return keyVault().encrypt(orgId, enc.encode(email));
}

async function openEmail(orgId: string, sealed: string | null): Promise<string> {
  if (!sealed) throw new DomainError('invalid_state', 'This request is closed');
  return new TextDecoder().decode(await keyVault().decrypt(orgId, sealed));
}

type Row = typeof dsarRequests.$inferSelect;

async function requestTx(tx: TenantTx, id: string, lock = false): Promise<Row> {
  const q = tx.select().from(dsarRequests).where(eq(dsarRequests.id, id));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found', 'No such request');
  return row;
}

async function openRequestTx(tx: TenantTx, subjectRef: string): Promise<Row | null> {
  const [row] = await tx
    .select()
    .from(dsarRequests)
    .where(and(eq(dsarRequests.subjectRef, subjectRef), eq(dsarRequests.status, 'open')));
  return row ?? null;
}

export const DsarRequestDto = z.object({
  id: z.uuid(),
  kind: z.enum(DSAR_KINDS),
  status: z.enum(DSAR_STATUSES),
  source: z.enum(DSAR_SOURCES),
  subjectHint: z.string(),
  requestedBy: z.uuid().nullable(),
  summary: DsarSummary,
  createdAt: z.date(),
  dueAt: z.date().nullable(),
  overdue: z.boolean(),
  verifiedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  /** An access archive can still be downloaded until this time. */
  archiveUntil: z.date().nullable(),
  hasReceipt: z.boolean(),
});
export type DsarRequestDto = z.infer<typeof DsarRequestDto>;

const numbers = (v: unknown): Record<string, number> =>
  Object.fromEntries(
    Object.entries((v ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, number] => typeof e[1] === 'number' && Number.isInteger(e[1]),
    ),
  );

export const toRequestDto = (r: Row, now: Date): DsarRequestDto => ({
  id: r.id,
  kind: r.kind as DsarRequestDto['kind'],
  status: r.status as DsarRequestDto['status'],
  source: r.source as DsarRequestDto['source'],
  subjectHint: r.subjectHint,
  requestedBy: r.requestedBy,
  summary: numbers(r.summary),
  createdAt: r.createdAt,
  dueAt: r.dueAt,
  overdue: r.status === 'open' && r.dueAt !== null && r.dueAt < now,
  verifiedAt: r.verifiedAt,
  completedAt: r.completedAt,
  cancelledAt: r.cancelledAt,
  archiveUntil: r.exportKey && r.exportExpiresAt && r.exportExpiresAt > now ? r.exportExpiresAt : null,
  hasReceipt: r.receipt !== null && r.signature !== null,
});

const OpenInput = z.object({ email: DsarEmail, kind: z.enum(DSAR_KINDS) });

async function insertRequestTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { email: string; kind: (typeof DSAR_KINDS)[number]; source: 'staff' | 'self' },
): Promise<Row> {
  const orgId = requireOrg(ctx);
  const [row] = await tx
    .insert(dsarRequests)
    .values({
      orgId,
      kind: input.kind,
      subjectRef: await subjectRefOf(input.email),
      subjectHint: maskEmail(input.email),
      requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      summary: {},
      status: 'open',
      source: input.source,
      dueAt: new Date(ctx.now.getTime() + DSAR_DUE_DAYS * DAY),
      verifiedAt: input.source === 'self' ? ctx.now : null,
      emailSealed: await sealEmail(orgId, input.email),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning();
  if (!row) throw new DomainError('internal');
  return row;
}

/** Staff open a request on the person's behalf (they checked who is asking). */
export const openRequestCommand = tenantCommand({
  name: 'privacy.openRequest',
  input: OpenInput,
  output: z.object({ requestId: z.uuid(), dueAt: z.date() }),
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: async ({ input, ctx, tx }) => {
    const email = normalizeEmail(input.email);
    const open = await openRequestTx(tx, await subjectRefOf(email));
    if (open)
      throw new DomainError('conflict', 'A request is already open for this person', { requestId: open.id });
    const row = await insertRequestTx(tx, ctx, { email, kind: input.kind, source: 'staff' });
    return { requestId: row.id, dueAt: row.dueAt as Date };
  },
  audit: (input, r) => ({
    action: 'privacy.request_opened',
    targetType: 'dsar_request',
    targetId: r.requestId,
    data: { kind: input.kind, source: 'staff' },
  }),
});

/**
 * The person asks themselves (self-service), after proving the address with an emailed code
 * (the web runs the check, then this as a system actor). A repeat while a request is open
 * returns the open one.
 */
export const submitSelfRequestCommand = tenantCommand({
  name: 'privacy.submitSelfRequest',
  input: OpenInput,
  output: z.object({ requestId: z.uuid(), dueAt: z.date(), existing: z.boolean() }),
  entitlement: 'core',
  permission: 'platform:privacy.self-request',
  handler: async ({ input, ctx, tx }) => {
    const email = normalizeEmail(input.email);
    const open = await openRequestTx(tx, await subjectRefOf(email));
    if (open) return { requestId: open.id, dueAt: open.dueAt as Date, existing: true };
    const row = await insertRequestTx(tx, ctx, { email, kind: input.kind, source: 'self' });
    return { requestId: row.id, dueAt: row.dueAt as Date, existing: false };
  },
  audit: (input, r) => ({
    action: 'privacy.request_opened',
    targetType: 'dsar_request',
    targetId: r.requestId,
    data: { kind: input.kind, source: 'self', existing: r.existing },
  }),
});

/** The org's requests, open ones first (by due date), then the closed ones (newest first). */
export const requestsQuery = tenantQuery({
  name: 'privacy.requests',
  input: z.object({ limit: z.int().min(1).max(100).default(50) }),
  output: z.object({ open: z.array(DsarRequestDto), closed: z.array(DsarRequestDto) }),
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: async ({ input, ctx, tx }) => {
    const open = await tx
      .select()
      .from(dsarRequests)
      .where(eq(dsarRequests.status, 'open'))
      .orderBy(asc(dsarRequests.dueAt), asc(dsarRequests.createdAt))
      .limit(input.limit);
    const closed = await tx
      .select()
      .from(dsarRequests)
      .where(inArray(dsarRequests.status, ['completed', 'cancelled']))
      .orderBy(desc(sql`coalesce(${dsarRequests.completedAt}, ${dsarRequests.cancelledAt})`))
      .limit(input.limit);
    return {
      open: open.map((r) => toRequestDto(r, ctx.now)),
      closed: closed.map((r) => toRequestDto(r, ctx.now)),
    };
  },
});

/**
 * One request. While it is open, staff see the address and what each module holds about the
 * person (counts); once an erasure is done, the signed receipt.
 */
export const requestQuery = tenantQuery({
  name: 'privacy.request',
  input: z.object({ requestId: z.uuid() }),
  output: z.object({
    request: DsarRequestDto,
    email: z.string().nullable(),
    holdings: DsarSummary.nullable(),
    cancelReason: z.string().nullable(),
    receipt: Receipt.nullable(),
    signature: z.string().nullable(),
  }),
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: async ({ input, ctx, tx }) => {
    const row = await requestTx(tx, input.requestId);
    let email: string | null = null;
    let holdings: Record<string, number> | null = null;
    if (row.status === 'open') {
      email = await openEmail(requireOrg(ctx), row.emailSealed);
      const subject = await resolveDataSubjectTx(tx, ctx, email);
      holdings = summarizeExport(await collectSubjectExportTx(tx, ctx, subject));
      delete holdings.privacy;
    }
    const receipt = row.receipt ? Receipt.parse(row.receipt) : null;
    return {
      request: toRequestDto(row, ctx.now),
      email,
      holdings,
      cancelReason: row.cancelReason,
      receipt,
      signature: row.signature,
    };
  },
});

const ARCHIVE_TYPE = 'application/zip';
const archiveKey = (orgId: string, requestId: string, hash: string) => `${orgId}/${requestId}/0-${hash}.zip`;

/**
 * Fulfil an access request: every module's data and files as one signed ZIP, stored for 7 days.
 * Starting it needs a recent step-up like any export (roadmap §10).
 */
export const exportSubjectCommand = tenantCommand({
  name: 'privacy.exportSubject',
  category: 'export',
  input: z.object({ requestId: z.uuid() }),
  output: z.object({
    requestId: z.uuid(),
    archiveUntil: z.date(),
    summary: DsarSummary,
    bytes: z.int(),
  }),
  entitlement: 'core',
  permission: 'privacy:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const row = await requestTx(tx, input.requestId, true);
    if (row.status !== 'open') throw new DomainError('invalid_state', 'This request is closed');
    if (row.kind !== 'access') throw new DomainError('invalid_state', 'This is an erasure request');
    const email = await openEmail(orgId, row.emailSealed);
    const subject = await resolveDataSubjectTx(tx, ctx, email);
    const modules = await collectSubjectExportTx(tx, ctx, subject);
    const archive = await buildArchive({
      requestId: row.id,
      controller: (await organizationNameTx(tx, orgId)) ?? '',
      email,
      generatedAt: ctx.now,
      modules,
      signer: dsarSigner(),
    });
    const hex = createHash('sha256').update(archive.bytes).digest('hex').slice(0, 32);
    const key = archiveKey(orgId, row.id, hex);
    // The object store is outside the transaction: if this transaction rolls back, the file is
    // unreachable (no row names it) and the archive retention sweep never sees it.
    await mediaStore().put(orgId, key, archive.bytes, ARCHIVE_TYPE);
    const archiveUntil = new Date(ctx.now.getTime() + DSAR_ARCHIVE_DAYS * DAY);
    const summary = summarizeExport(modules);
    await tx
      .update(dsarRequests)
      .set({
        status: 'completed',
        completedAt: ctx.now,
        emailSealed: null,
        exportKey: key,
        exportExpiresAt: archiveUntil,
        summary,
        updatedAt: ctx.now,
      })
      .where(eq(dsarRequests.id, row.id));
    return { requestId: row.id, archiveUntil, summary, bytes: archive.bytes.length };
  },
  audit: (_input, r) => ({
    action: 'privacy.export',
    targetType: 'dsar_request',
    targetId: r.requestId,
    data: { modules: Object.keys(r.summary).length, bytes: r.bytes },
  }),
});

const ArchiveFile = z.object({
  name: z.string(),
  contentType: z.literal(ARCHIVE_TYPE),
  bytes: z.instanceof(Uint8Array),
});

async function archiveOf(tx: TenantTx, ctx: Ctx, requestId: string) {
  const row = await requestTx(tx, requestId);
  if (!row.exportKey || !row.exportExpiresAt || row.exportExpiresAt <= ctx.now)
    throw new DomainError('not_found', 'The archive has expired or was deleted');
  const bytes = await mediaStore().get(requireOrg(ctx), row.exportKey);
  if (!bytes) throw new DomainError('not_found', 'The archive has expired or was deleted');
  const day = (row.completedAt ?? ctx.now).toISOString().slice(0, 10);
  return { name: `personal-data-${day}.zip`, contentType: ARCHIVE_TYPE, bytes };
}

/** Download the archive (owners and admins; data leaving: refused while staff act as a member). */
export const archiveFileQuery = tenantQuery({
  name: 'privacy.archiveFile',
  category: 'export',
  input: z.object({ requestId: z.uuid() }),
  output: ArchiveFile,
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: ({ input, ctx, tx }) => archiveOf(tx, ctx, input.requestId),
});

/** The person's own download (a signed link emailed to them; the web checks the link). */
export const selfArchiveFileQuery = tenantQuery({
  name: 'privacy.selfArchiveFile',
  category: 'export',
  input: z.object({ requestId: z.uuid() }),
  output: ArchiveFile,
  entitlement: 'core',
  permission: 'platform:privacy.self-request',
  handler: async ({ input, ctx, tx }) => {
    const row = await requestTx(tx, input.requestId);
    if (row.source !== 'self') throw new DomainError('not_found', 'No such request');
    return archiveOf(tx, ctx, input.requestId);
  },
});

export const EraseOutput = z.object({
  requestId: z.uuid(),
  receipt: Receipt,
  signature: z.string(),
  /** Stored files to delete after commit (the media subscriber does it from the outbox event). */
  files: z.int(),
});

/**
 * Fulfil an erasure request (right to be forgotten). The caller types the address again and
 * must have signed in recently. Every module erases or redacts its rows in this transaction;
 * rows the law makes us keep are kept with the person's name and address replaced and listed in
 * the signed receipt. Stored files go after commit (`privacy.subject_erased@1` → media), and the
 * same event calls the connector hooks (M6.4).
 */
export const eraseSubjectCommand = tenantCommand({
  name: 'privacy.eraseSubject',
  category: 'delete',
  input: z.object({ requestId: z.uuid(), confirm: z.string().max(320) }),
  output: EraseOutput,
  entitlement: 'core',
  permission: 'privacy:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const row = await requestTx(tx, input.requestId, true);
    if (row.status !== 'open') throw new DomainError('invalid_state', 'This request is closed');
    if (row.kind !== 'erasure') throw new DomainError('invalid_state', 'This is an access request');
    const email = await openEmail(orgId, row.emailSealed);
    if (normalizeEmail(input.confirm) !== email)
      throw new DomainError('validation_failed', 'Type the email again to confirm', { field: 'confirm' });
    const subject = await resolveDataSubjectTx(tx, ctx, email);
    const outcome = await eraseSubjectEverywhereTx(tx, ctx, subject);
    // Platform-wide (M1.14e): no org mails or re-imports the address for marketing again.
    await markAddressErasedTx(tx, email);
    const signer = dsarSigner();
    const receipt: Receipt = {
      format: RECEIPT_FORMAT,
      requestId: row.id,
      org: { id: orgId, name: (await organizationNameTx(tx, orgId)) ?? '' },
      subject: { hint: row.subjectHint, ref: row.subjectRef },
      source: row.source as Receipt['source'],
      requestedAt: row.createdAt.toISOString(),
      dueAt: row.dueAt?.toISOString() ?? null,
      completedAt: ctx.now.toISOString(),
      erased: Object.entries(outcome.erased)
        .map(([table, rows]) => ({
          table,
          action: (outcome.actions[table] ?? 'redact') as 'delete' | 'redact' | 'hold',
          rows,
        }))
        .sort((a, b) => a.table.localeCompare(b.table)),
      held: outcome.held.map((h) => ({ ...h, until: h.until ?? null })),
      files: outcome.mediaAssets.length,
      connectors: erasureConnectorHooks().map((h) => h.name),
      suppressed: true,
      key: { algorithm: 'Ed25519', id: signer.keyId },
    };
    const signature = await signReceipt(receipt, signer);
    await tx
      .update(dsarRequests)
      .set({
        status: 'completed',
        completedAt: ctx.now,
        emailSealed: null,
        summary: outcome.erased,
        receipt,
        signature,
        updatedAt: ctx.now,
      })
      .where(eq(dsarRequests.id, row.id));
    emit({
      type: 'privacy.subject_erased',
      version: 1,
      aggregateType: 'dsar_request',
      aggregateId: row.id,
      payload: { orgId, requestId: row.id, subjectRef: row.subjectRef, mediaAssets: outcome.mediaAssets },
    });
    return { requestId: row.id, receipt, signature, files: outcome.mediaAssets.length };
  },
  audit: (_input, r) => ({
    action: 'privacy.erase',
    targetType: 'dsar_request',
    targetId: r.requestId,
    data: {
      kind: 'erasure',
      rows: r.receipt.erased.reduce((n, t) => n + t.rows, 0),
      held: r.receipt.held.length,
      files: r.files,
    },
  }),
});

/** The person's own copy of the receipt (a signed link emailed to them; no personal data in it). */
export const selfReceiptQuery = tenantQuery({
  name: 'privacy.selfReceipt',
  input: z.object({ requestId: z.uuid() }),
  output: z.object({ receipt: Receipt, signature: z.string() }),
  entitlement: 'core',
  permission: 'platform:privacy.self-request',
  handler: async ({ input, tx }) => {
    const row = await requestTx(tx, input.requestId);
    if (row.source !== 'self' || !row.receipt || !row.signature)
      throw new DomainError('not_found', 'No such receipt');
    return { receipt: Receipt.parse(row.receipt), signature: row.signature };
  },
});

/** Withdraw an open request (the person withdrew it, or it was not genuine). */
export const cancelRequestCommand = tenantCommand({
  name: 'privacy.cancelRequest',
  input: z.object({ requestId: z.uuid(), reason: z.string().trim().min(3).max(500) }),
  output: z.object({ requestId: z.uuid() }),
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: async ({ input, ctx, tx }) => {
    const row = await requestTx(tx, input.requestId, true);
    if (row.status !== 'open') throw new DomainError('invalid_state', 'This request is closed');
    await tx
      .update(dsarRequests)
      .set({
        status: 'cancelled',
        cancelledAt: ctx.now,
        cancelReason: input.reason,
        emailSealed: null,
        updatedAt: ctx.now,
      })
      .where(eq(dsarRequests.id, row.id));
    return { requestId: row.id };
  },
  audit: (_input, r) => ({
    action: 'privacy.request_cancelled',
    targetType: 'dsar_request',
    targetId: r.requestId,
  }),
});

/**
 * Who to tell that a self-service request is done (the web emails them the link): the address
 * while the request is open, for self-service requests only. Called by the web before it runs
 * the export or erasure, so the address never has to leave a command's output.
 */
export async function selfRequestAddressTx(
  tx: TenantTx,
  ctx: Ctx,
  requestId: string,
): Promise<string | null> {
  const row = await requestTx(tx, requestId);
  if (row.source !== 'self' || row.status !== 'open') return null;
  return openEmail(requireOrg(ctx), row.emailSealed);
}

/** Retention: archives past their 7 days lose their stored file. */
export async function purgeExpiredArchivesTx(tx: TenantTx, ctx: Ctx): Promise<number> {
  const due = await tx
    .update(dsarRequests)
    .set({ exportKey: null, exportExpiresAt: null, updatedAt: ctx.now })
    .where(sql`${dsarRequests.exportKey} is not null and ${dsarRequests.exportExpiresAt} <= ${ctx.now}`)
    .returning({ id: dsarRequests.id });
  for (const r of due) await mediaStore().deleteAsset(requireOrg(ctx), r.id);
  return due.length;
}
