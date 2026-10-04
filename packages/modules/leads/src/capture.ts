import { badgeCompanyTitleTx } from '@yayatoh/badges';
import { resolveCode } from '@yayatoh/checkin';
import { contactIdByEmailTx, currentConsentEntryTx, normalizeEmail } from '@yayatoh/crm';
import { csvRow } from '@yayatoh/csv';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx, portalAccountsTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg, utcToZonedInput } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { exhibitorPrincipalTx, leadSeatStandingTx } from '@yayatoh/program';
import { registrantProfilesByTicketTx } from '@yayatoh/registration';
import { ticketHoldersTx } from '@yayatoh/ticketing';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  accessOpen,
  type CaptureWindow,
  canSeeLead,
  captureState,
  captureTime,
  captureWindow,
  LEAD_TERMS_VERSION,
  MAX_QUALIFIERS,
  mergeNotes,
  NOTES_MAX,
  pickQualifiers,
  QUALIFIER_MAX,
  RATINGS,
  type Rating,
  type SharedField,
  sharedFields,
} from './domain/rules.ts';
import {
  type LeadDto,
  LeadListDto,
  LeadSetupDto,
  leadExportRowSerializer,
  leadSerializer,
  leadSetupSerializer,
  type ScanInput,
  type ScanResultDto,
  SyncInput,
  SyncResultDto,
  syncResultSerializer,
} from './dto.ts';
import { exhibitorLeadSettings, leadScans, leads } from './schema.ts';

/**
 * M5.6b lead retrieval (P5-4, P5-8). Exhibitor people (M5.3a portal accounts of an exhibitor,
 * M5.4a) capture leads in the Scan PWA's lead mode by scanning badge QRs (a badge reads as the
 * ticket's signed code). Capture needs a lead license within the exhibitor's allowance (M5.4b),
 * the exhibitor admin's acceptance of the lead terms, and the P5-4 window. A scan shares the
 * P5-8 allowlist only: name, job title, company, and the email only with the attendee's consent
 * (`exhibitor_email_sharing` in the consent ledger). Every command acts on the principal's own
 * exhibitor, re-checked in its transaction.
 */

type Emit = (e: Omit<DomainEvent, 'id' | 'occurredAt' | 'orgId'> & Partial<DomainEvent>) => void;

export interface LeadContext {
  readonly principal: Awaited<ReturnType<typeof exhibitorPrincipalTx>>['principal'];
  readonly exhibitor: { readonly id: string; readonly name: string };
  readonly event: { readonly id: string; readonly name: string; readonly timezone: string };
  readonly window: CaptureWindow;
  readonly settings: {
    readonly teamVisibility: boolean;
    readonly qualifiers: string[];
    readonly termsAccepted: boolean;
  };
  readonly license: 'licensed' | 'unlicensed' | 'over_allowance';
  readonly admin: boolean;
}

export async function leadSettingsRowTx(tx: TenantTx, exhibitorId: string) {
  const [row] = await tx
    .select()
    .from(exhibitorLeadSettings)
    .where(eq(exhibitorLeadSettings.exhibitorId, exhibitorId));
  return row ?? null;
}

/** The signed-in exhibitor person, their exhibitor, the event's window and the license. */
export async function leadContextTx(
  tx: TenantTx,
  ctx: Ctx,
  need: 'admin' | 'any' = 'any',
): Promise<LeadContext> {
  const { principal, exhibitor } = await exhibitorPrincipalTx(tx, ctx, need);
  const event = await findEventTx(tx, principal.eventId);
  if (!event) throw new DomainError('not_found');
  const row = await leadSettingsRowTx(tx, exhibitor.id);
  const seat = await leadSeatStandingTx(tx, ctx, event.id, exhibitor.id, principal.accountId);
  return {
    principal,
    exhibitor: { id: exhibitor.id, name: exhibitor.name },
    event: { id: event.id, name: event.name, timezone: event.timezone },
    window: captureWindow(event),
    settings: {
      teamVisibility: row?.teamVisibility ?? false,
      qualifiers: row?.qualifiers ?? [],
      termsAccepted: (row?.termsVersion ?? 0) >= LEAD_TERMS_VERSION,
    },
    license: seat.standing,
    admin: principal.role === 'exhibitor_admin',
  };
}

const noAccess = (reason: string) => new DomainError('invalid_state', 'Lead access has ended', { reason });

/** Notes, ratings, lists and export end 90 days after the event (P5-4). */
function requireAccess(c: LeadContext, now: Date) {
  if (!accessOpen(c.window, now)) throw noAccess('access_ended');
}

/** Capturing needs a license within the allowance and the admin's acceptance of the lead terms. */
function requireCapture(c: LeadContext) {
  if (c.license === 'unlicensed')
    throw new DomainError('forbidden', 'A lead license is needed', { reason: 'no_license' });
  if (c.license === 'over_allowance')
    throw new DomainError('forbidden', 'This license is beyond the allowance', { reason: 'over_allowance' });
  if (!c.settings.termsAccepted)
    throw new DomainError('invalid_state', 'The lead terms are not accepted', {
      reason: 'terms_not_accepted',
    });
}

/* ---------------------------------------------------------------------- the view ---- */

type LeadRow = typeof leads.$inferSelect;

async function emailsOfAccountsTx(tx: TenantTx, ctx: Ctx, eventId: string) {
  return new Map((await portalAccountsTx(tx, eventId, 'exhibitor', ctx.now)).map((a) => [a.id, a.email]));
}

async function scannedByTx(tx: TenantTx, accountId: string, leadIds: readonly string[]) {
  if (leadIds.length === 0) return new Set<string>();
  const rows = await tx
    .selectDistinct({ leadId: leadScans.leadId })
    .from(leadScans)
    .where(and(eq(leadScans.accountId, accountId), inArray(leadScans.leadId, [...leadIds])));
  return new Set(rows.map((r) => r.leadId));
}

function toDto(c: LeadContext, row: LeadRow, mine: boolean, emails: Map<string, string>): LeadDto {
  const showScanner = c.admin || c.settings.teamVisibility;
  return leadSerializer.serialize({
    id: row.id,
    name: row.name,
    jobTitle: row.jobTitle,
    company: row.company,
    email: row.emailWithdrawnAt ? null : row.email,
    sharedFields: row.sharedFields,
    emailConsentVersion: row.emailConsentVersion,
    emailWithdrawnAt: row.emailWithdrawnAt,
    rating: row.rating,
    qualifiers: row.qualifiers,
    notes: row.notes,
    capturedAt: row.capturedAt,
    lastScannedAt: row.lastScannedAt,
    scans: row.scans,
    scannedByMe: mine,
    scannedBy: showScanner ? (emails.get(row.capturedBy) ?? null) : null,
  });
}

/** Leads the caller may see: the admin all, staff their own (or the team's when shared). */
async function visibleLeadsTx(tx: TenantTx, ctx: Ctx, c: LeadContext): Promise<LeadDto[]> {
  const rows = await tx
    .select()
    .from(leads)
    .where(eq(leads.exhibitorId, c.exhibitor.id))
    .orderBy(desc(leads.lastScannedAt), desc(leads.id));
  const mine = await scannedByTx(
    tx,
    c.principal.accountId,
    rows.map((r) => r.id),
  );
  const emails = await emailsOfAccountsTx(tx, ctx, c.event.id);
  return rows
    .filter((r) =>
      canSeeLead({ admin: c.admin, teamVisibility: c.settings.teamVisibility, scannedByMe: mine.has(r.id) }),
    )
    .map((r) => toDto(c, r, mine.has(r.id), emails));
}

/** One lead the caller may see, or `not_found` (another exhibitor's or a teammate's look the same). */
async function visibleLeadTx(tx: TenantTx, c: LeadContext, leadId: string, lock = false) {
  const q = tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.exhibitorId, c.exhibitor.id)));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found');
  const mine = (await scannedByTx(tx, c.principal.accountId, [row.id])).has(row.id);
  if (!canSeeLead({ admin: c.admin, teamVisibility: c.settings.teamVisibility, scannedByMe: mine }))
    throw new DomainError('not_found');
  return { row, mine };
}

/* --------------------------------------------------------------------- the setup ---- */

/** The person's lead mode: license, terms, capture window, qualifiers (PWA and portal). */
export const leadSetupQuery = tenantQuery({
  name: 'leads.setup',
  input: z.object({}),
  output: LeadSetupDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor',
  handler: async ({ ctx, tx }) => {
    const c = await leadContextTx(tx, ctx);
    const [count] = c.admin
      ? await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(leads)
          .where(eq(leads.exhibitorId, c.exhibitor.id))
      : [{ n: 0 }];
    return leadSetupSerializer.serialize({
      eventName: c.event.name,
      timezone: c.event.timezone,
      exhibitorName: c.exhibitor.name,
      role: c.principal.role,
      email: c.principal.email,
      license: c.license,
      termsAccepted: c.settings.termsAccepted,
      termsVersion: LEAD_TERMS_VERSION,
      capture: {
        state: captureState(c.window, ctx.now),
        ...c.window,
        accessOpen: accessOpen(c.window, ctx.now),
      },
      qualifiers: c.settings.qualifiers,
      teamVisibility: c.settings.teamVisibility,
      leadCount: count?.n ?? 0,
    });
  },
});

/* ----------------------------------------------------------------------- capture ---- */

/** The P5-8 allowlist of the person behind a ticket, and whether their email may be shared. */
async function personTx(
  tx: TenantTx,
  eventId: string,
  ticket: { readonly id: string; readonly orderId: string; readonly ticketTypeId: string },
) {
  const ticketId = ticket.id;
  const reg = (await registrantProfilesByTicketTx(tx, [ticketId])).get(ticketId);
  // What the registrant said, else what the badge template maps from checkout answers.
  const badge = (await badgeCompanyTitleTx(tx, eventId, [ticket])).get(ticketId);
  const holder = (await ticketHoldersTx(tx, [ticketId])).get(ticketId);
  const email = normalizeEmail(holder?.holderEmail ?? reg?.email ?? '');
  const contactId = email ? await contactIdByEmailTx(tx, email) : null;
  const consent = contactId ? await currentConsentEntryTx(tx, contactId, 'email', 'exhibitor_sharing') : null;
  const shares = consent?.status === 'granted' && consent.version !== null;
  return {
    name: (holder?.holderName ?? reg?.name ?? '').slice(0, 200),
    jobTitle: (reg?.jobTitle || badge?.jobTitle || '').slice(0, 200),
    company: (reg?.company || badge?.company || '').slice(0, 200),
    email: shares ? email : null,
    consentVersion: shares ? consent.version : null,
    fields: sharedFields(shares) as SharedField[],
  };
}

async function applyScanTx(
  tx: TenantTx,
  ctx: Ctx,
  c: LeadContext,
  s: ScanInput,
  emit: Emit,
): Promise<{ result: Omit<ScanResultDto, 'lead'>; leadId: string | null }> {
  const refused = (reason: ScanResultDto['reason']) => ({
    result: { scanId: s.scanId, status: 'refused' as const, reason },
    leadId: null,
  });
  // Exactly once: a scan id seen before answers as it did then.
  const [prior] = await tx
    .select({ leadId: leadScans.leadId, result: leadScans.result })
    .from(leadScans)
    .where(and(eq(leadScans.exhibitorId, c.exhibitor.id), eq(leadScans.scanId, s.scanId)));
  if (prior)
    return {
      result: { scanId: s.scanId, status: prior.result as 'captured' | 'rescanned', reason: null },
      leadId: prior.leadId,
    };
  const at = captureTime(s.capturedAt, ctx.now);
  const state = captureState(c.window, at);
  if (state !== 'open') return refused(state);
  const { ticket } = await resolveCode(tx, s.code);
  if (ticket?.status !== 'active') return refused('invalid');
  if (ticket.eventId !== c.event.id) return refused('wrong_event');

  const qualifiers = s.qualifiers ? pickQualifiers(c.settings.qualifiers, s.qualifiers) : undefined;
  const [existing] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.exhibitorId, c.exhibitor.id), eq(leads.ticketId, ticket.id)))
    .for('update');
  let leadId: string;
  let status: 'captured' | 'rescanned';
  if (existing) {
    status = 'rescanned';
    leadId = existing.id;
    await tx
      .update(leads)
      .set({
        scans: existing.scans + 1,
        lastScannedAt: at > existing.lastScannedAt ? at : existing.lastScannedAt,
        ...(s.rating !== undefined ? { rating: s.rating } : {}),
        ...(qualifiers ? { qualifiers } : {}),
        notes: mergeNotes(existing.notes, s.notes),
        updatedAt: ctx.now,
      })
      .where(eq(leads.id, existing.id));
  } else {
    status = 'captured';
    const p = await personTx(tx, c.event.id, ticket);
    const [row] = await tx
      .insert(leads)
      .values({
        orgId: requireOrg(ctx),
        eventId: c.event.id,
        exhibitorId: c.exhibitor.id,
        ticketId: ticket.id,
        capturedBy: c.principal.accountId,
        capturedAt: at,
        lastScannedAt: at,
        name: p.name,
        jobTitle: p.jobTitle,
        company: p.company,
        email: p.email,
        sharedFields: p.fields,
        emailConsentVersion: p.consentVersion,
        rating: s.rating ?? null,
        qualifiers: qualifiers ?? [],
        notes: mergeNotes('', s.notes),
      })
      .returning({ id: leads.id });
    if (!row) throw new DomainError('internal');
    leadId = row.id;
    emit({
      type: 'leads.captured',
      version: 1,
      aggregateType: 'lead',
      aggregateId: leadId,
      payload: {
        orgId: requireOrg(ctx),
        eventId: c.event.id,
        exhibitorId: c.exhibitor.id,
        leadId,
        emailShared: p.email !== null,
      },
    });
  }
  await tx.insert(leadScans).values({
    orgId: requireOrg(ctx),
    eventId: c.event.id,
    exhibitorId: c.exhibitor.id,
    leadId,
    scanId: s.scanId,
    accountId: c.principal.accountId,
    capturedAt: at,
    offline: s.offline,
    result: status,
  });
  return { result: { scanId: s.scanId, status, reason: null }, leadId };
}

/**
 * Capture leads: one scan online, or the offline queue in batches. Each scan id is applied once
 * (a retry or a racing batch answers as the first time); the exhibitor's batches run one at a
 * time under an advisory lock. A scan is checked against the window at its own time, so a scan
 * made offline before capture closed still counts when it syncs later.
 */
export const syncLeadScansCommand = tenantCommand({
  name: 'leads.syncScans',
  input: SyncInput,
  output: SyncResultDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx, emit }) => {
    const c = await leadContextTx(tx, ctx);
    requireAccess(c, ctx.now);
    requireCapture(c);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`leads:${c.exhibitor.id}`}, 0))`);
    const applied: { result: Omit<ScanResultDto, 'lead'>; leadId: string | null }[] = [];
    for (const s of input.scans) applied.push(await applyScanTx(tx, ctx, c, s, emit as Emit));
    const ids = [...new Set(applied.flatMap((a) => (a.leadId ? [a.leadId] : [])))];
    const rows = ids.length ? await tx.select().from(leads).where(inArray(leads.id, ids)) : [];
    const mine = await scannedByTx(tx, c.principal.accountId, ids);
    const emails = await emailsOfAccountsTx(tx, ctx, c.event.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return syncResultSerializer.serialize({
      results: applied.map((a) => {
        const row = a.leadId ? byId.get(a.leadId) : undefined;
        return { ...a.result, lead: row ? toDto(c, row, mine.has(row.id), emails) : null };
      }),
    });
  },
  audit: (input, r) => ({
    action: 'leads.scans.sync',
    targetType: 'lead_scan_batch',
    targetId: null,
    data: {
      scans: input.scans.length,
      captured: r?.results.filter((x) => x.status === 'captured').length ?? 0,
      refused: r?.results.filter((x) => x.status === 'refused').length ?? 0,
    },
  }),
});

/* -------------------------------------------------------------------- the leads ---- */

export const myLeadsQuery = tenantQuery({
  name: 'leads.myLeads',
  input: z.object({}),
  output: LeadListDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor',
  handler: async ({ ctx, tx }) => {
    const c = await leadContextTx(tx, ctx);
    requireAccess(c, ctx.now);
    return {
      leads: await visibleLeadsTx(tx, ctx, c),
      scope: c.admin ? ('all' as const) : c.settings.teamVisibility ? ('team' as const) : ('own' as const),
    };
  },
});

/** Rate, qualify and annotate a lead the caller may see (until lead access ends). */
export const updateLeadCommand = tenantCommand({
  name: 'leads.updateLead',
  input: z.object({
    leadId: z.uuid(),
    rating: z.enum(RATINGS).nullable(),
    qualifiers: z.array(z.string().max(QUALIFIER_MAX)).max(MAX_QUALIFIERS),
    notes: z.string().max(NOTES_MAX),
  }),
  output: z.object({ leadId: z.uuid(), exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx }) => {
    const c = await leadContextTx(tx, ctx);
    requireAccess(c, ctx.now);
    const { row } = await visibleLeadTx(tx, c, input.leadId, true);
    await tx
      .update(leads)
      .set({
        rating: input.rating as Rating | null,
        qualifiers: pickQualifiers(c.settings.qualifiers, input.qualifiers),
        notes: input.notes.trim(),
        updatedAt: ctx.now,
      })
      .where(eq(leads.id, row.id));
    return { leadId: row.id, exhibitorId: c.exhibitor.id };
  },
  audit: (input, r) => ({
    action: 'leads.lead.update',
    targetType: 'lead',
    targetId: input.leadId,
    data: { exhibitorId: r?.exhibitorId, rating: input.rating, qualifiers: input.qualifiers.length },
  }),
});

/* ------------------------------------------------------------------------ export ---- */

export const EXPORT_COLUMNS = [
  'name',
  'jobTitle',
  'company',
  'email',
  'rating',
  'qualifiers',
  'notes',
  'capturedAt',
  'scannedBy',
  'scans',
  'sharedFields',
  'emailConsentVersion',
] as const;

/**
 * The exhibitor admin's CSV export of every lead (P5-8: the exhibitor is the controller). Needs
 * step-up (a fresh emailed sign-in code in the last 10 minutes) and lead access (90 days after
 * the event). Rows go through the export allowlist; times are in the event's time zone; values
 * that look like formulas are neutralised. `headers` are the caller's translated column names.
 */
export const exportLeadsCommand = tenantCommand({
  name: 'leads.exportLeads',
  input: z.object({ headers: z.array(z.string().max(80)).length(EXPORT_COLUMNS.length) }),
  output: z.object({ csv: z.string(), count: z.int(), exhibitorName: z.string(), exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const c = await leadContextTx(tx, ctx, 'admin');
    requireAccess(c, ctx.now);
    const rows = await tx
      .select()
      .from(leads)
      .where(eq(leads.exhibitorId, c.exhibitor.id))
      .orderBy(asc(leads.capturedAt), asc(leads.id));
    const emails = await emailsOfAccountsTx(tx, ctx, c.event.id);
    let csv = `﻿${csvRow(input.headers)}`;
    for (const r of rows) {
      const x = leadExportRowSerializer.serialize({
        name: r.name,
        jobTitle: r.jobTitle,
        company: r.company,
        email: r.emailWithdrawnAt ? '' : (r.email ?? ''),
        rating: r.rating ?? '',
        qualifiers: r.qualifiers.join('; '),
        notes: r.notes,
        capturedAt: `${utcToZonedInput(r.capturedAt, c.event.timezone).replace('T', ' ')} ${c.event.timezone}`,
        scannedBy: emails.get(r.capturedBy) ?? '',
        scans: r.scans,
        sharedFields: r.sharedFields.join(' '),
        emailConsentVersion: r.emailConsentVersion === null ? '' : `v${r.emailConsentVersion}`,
      });
      csv += csvRow(EXPORT_COLUMNS.map((k) => x[k]));
    }
    return { csv, count: rows.length, exhibitorName: c.exhibitor.name, exhibitorId: c.exhibitor.id };
  },
  audit: (_input, r) => ({
    action: 'leads.export',
    targetType: 'program_exhibitor',
    targetId: r?.exhibitorId ?? null,
    data: { rows: r?.count ?? 0 },
  }),
});
