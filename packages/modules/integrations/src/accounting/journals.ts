import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { donationDailyTotalsTx } from '@yayatoh/donations';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { ledgerDailyTotalsTx } from '@yayatoh/payments';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { organizationDefaultsTx } from '@yayatoh/tenancy';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { connectionTx, requireConnector } from '../connections.ts';
import { bumpRunTx, recordErrorTx, resolveErrorsTx, runningTx } from '../engine.ts';
import { accountingJournals, accountMaps, connections, syncErrors } from '../schema.ts';
import {
  ACCOUNT_CATEGORIES,
  AccountMap,
  addDays,
  type DayHistoryRow,
  type DaySummary,
  DaySummarySchema,
  dayIn,
  debitTotal,
  EMPTY_SUMMARY,
  JOURNAL_KINDS,
  JOURNAL_STATUSES,
  JournalLine,
  journalKey,
  journalLines,
  MAX_BACKFILL_DAYS,
  planDay,
  reversalLines,
  summaryKey,
  validateAccountMap,
} from './domain.ts';

/**
 * Accounting summaries (M6.5d): the chart-of-accounts mapping, preparing each day's journal from
 * the ledger (reverse and re-post on correction, never an edit) and recording what the provider
 * answered. The provider calls happen in `run.ts`, between these commands, like the sync engine's
 * pushes. Every journal row is append-only in meaning: only its delivery state changes.
 */

/** The engine's system permission (`engine.ts`), spelled out: this file loads inside its import cycle. */
const SYNC_PERMISSION = 'platform:integrations.sync';
/** The object type journals use in the errors inbox and run counts. */
export const JOURNALS_OBJECT = 'journals';
export const journalRecordKey = (journalId: string) => `${JOURNALS_OBJECT}:local:${journalId}`;
/** Journals the console lists. */
export const RECENT_JOURNALS = 60;

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AccountMapDto = z.object({
  version: z.int(),
  accounts: AccountMap,
  startsOn: DAY,
  createdAt: z.date(),
});
export type AccountMapDto = z.infer<typeof AccountMapDto>;

export const JournalDto = z.object({
  id: z.uuid(),
  day: DAY,
  currency: z.string(),
  revision: z.int(),
  kind: z.enum(JOURNAL_KINDS),
  status: z.enum(JOURNAL_STATUSES),
  debitTotalMinor: z.int(),
  lines: z.array(JournalLine),
  externalId: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  attempts: z.int(),
  postedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type JournalDto = z.infer<typeof JournalDto>;

export const AccountingDetailDto = z.object({
  map: AccountMapDto.nullable(),
  journals: z.array(JournalDto),
  /** Journals waiting to be sent or retried. */
  waiting: z.int(),
});
export type AccountingDetailDto = z.infer<typeof AccountingDetailDto>;
export const accountingDetailSerializer = defineSerializer(
  'integrations.accountingDetail',
  AccountingDetailDto,
);

type MapRow = typeof accountMaps.$inferSelect;
type JournalRow = typeof accountingJournals.$inferSelect;

/** The mapping in force (the newest version), or null before the first save. */
export async function currentAccountMapTx(tx: TenantTx, connectionId: string): Promise<MapRow | null> {
  const [m] = await tx
    .select()
    .from(accountMaps)
    .where(eq(accountMaps.connectionId, connectionId))
    .orderBy(desc(accountMaps.version))
    .limit(1);
  return m ?? null;
}

const parseLines = (raw: unknown): JournalLine[] =>
  Array.isArray(raw) ? raw.flatMap((l) => (JournalLine.safeParse(l).success ? [l as JournalLine] : [])) : [];

const mapDto = (m: MapRow): AccountMapDto | null => {
  const accounts = AccountMap.safeParse(m.accounts);
  return accounts.success
    ? { version: m.version, accounts: accounts.data, startsOn: m.startsOn, createdAt: m.createdAt }
    : null;
};

const journalDto = (r: JournalRow): JournalDto => ({
  id: r.id,
  day: r.day,
  currency: r.currency,
  revision: r.revision,
  kind: r.kind as JournalDto['kind'],
  status: r.status as JournalDto['status'],
  debitTotalMinor: r.debitTotalMinor,
  lines: parseLines(r.lines),
  externalId: r.externalId,
  lastErrorCode: r.lastErrorCode,
  attempts: r.attempts,
  postedAt: r.postedAt,
  createdAt: r.createdAt,
});

async function requireAccountingConnectionTx(tx: TenantTx, connectionId: string, lock = false) {
  const c = await connectionTx(tx, connectionId, lock);
  if (!requireConnector(c.connector).accounting)
    throw new DomainError('not_found', 'Not an accounting connection');
  return c;
}

/** One accounting connection's mapping and its newest journals (the console). */
export const accountingDetailQuery = tenantQuery({
  name: 'integrations.accountingDetail',
  input: z.object({ connectionId: z.uuid() }),
  output: AccountingDetailDto,
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const c = await requireAccountingConnectionTx(tx, input.connectionId);
    const [map, rows, [waiting]] = await Promise.all([
      currentAccountMapTx(tx, c.id),
      tx
        .select()
        .from(accountingJournals)
        .where(
          and(eq(accountingJournals.connectionId, c.id), sql`${accountingJournals.status} <> 'superseded'`),
        )
        .orderBy(
          desc(accountingJournals.day),
          desc(accountingJournals.createdAt),
          desc(accountingJournals.id),
        )
        .limit(RECENT_JOURNALS),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(accountingJournals)
        .where(
          and(
            eq(accountingJournals.connectionId, c.id),
            inArray(accountingJournals.status, ['pending', 'failed']),
          ),
        ),
    ]);
    return { map: map ? mapDto(map) : null, journals: rows.map(journalDto), waiting: waiting?.n ?? 0 };
  },
});

/** What the console needs to ask the provider for the chart of accounts (stays on the server). */
export const accountingRefQuery = tenantQuery({
  name: 'integrations.accountingRef',
  input: z.object({ connectionId: z.uuid() }),
  output: z.object({
    connector: z.string(),
    status: z.string(),
    authConnectionId: z.string().nullable(),
  }),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const c = await requireAccountingConnectionTx(tx, input.connectionId);
    return { connector: c.connector, status: c.status, authConnectionId: c.authConnectionId };
  },
});

/**
 * Save the chart-of-accounts mapping as the next version (`integrations:manage`). The caller
 * resolved each chosen account against the provider's chart (`chartOfAccounts`); here the
 * categories, the clearing rule and the first day are checked. The next sync posts with it.
 */
export const saveAccountMapCommand = tenantCommand({
  name: 'integrations.saveAccountMap',
  input: z.object({
    connectionId: z.uuid(),
    accounts: AccountMap,
    startsOn: DAY,
  }),
  output: AccountMapDto,
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const c = await requireAccountingConnectionTx(tx, input.connectionId, true);
    if (c.status !== 'active' && c.status !== 'paused')
      throw new DomainError('invalid_state', 'Map accounts on a connected integration');
    const chosen = Object.fromEntries(ACCOUNT_CATEGORIES.map((k) => [k, input.accounts[k].id]));
    const issues: { path: string; code: string; field: string }[] = validateAccountMap(
      chosen,
      Object.values(input.accounts),
    ).map((p) => ({ path: `accounts.${p.category}`, code: p.code, field: p.category }));
    const timeZone = (await organizationDefaultsTx(tx, orgId))?.timezone ?? 'UTC';
    const today = dayIn(ctx.now, timeZone);
    if (input.startsOn > today)
      issues.push({ path: 'startsOn', code: 'starts_in_future', field: 'startsOn' });
    else if (input.startsOn < addDays(today, -MAX_BACKFILL_DAYS))
      issues.push({ path: 'startsOn', code: 'starts_too_early', field: 'startsOn' });
    if (issues.length)
      throw new DomainError('validation_failed', 'The account mapping is not valid', { issues });
    const [last] = await tx
      .select({ version: accountMaps.version })
      .from(accountMaps)
      .where(eq(accountMaps.connectionId, c.id))
      .orderBy(desc(accountMaps.version))
      .limit(1);
    const [row] = await tx
      .insert(accountMaps)
      .values({
        orgId,
        connectionId: c.id,
        version: (last?.version ?? 0) + 1,
        accounts: input.accounts,
        startsOn: input.startsOn,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    // Posting starts (or follows the new mapping) on the next run: make it due now.
    if (c.status === 'active')
      await tx
        .update(connections)
        .set({ nextSyncAt: ctx.now, updatedAt: ctx.now })
        .where(eq(connections.id, c.id));
    return {
      version: row.version,
      accounts: input.accounts,
      startsOn: row.startsOn,
      createdAt: row.createdAt,
    };
  },
  audit: (input, r) => ({
    action: 'integrations.accounting.map_save',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: {
      version: r.version,
      startsOn: r.startsOn,
      accounts: Object.fromEntries(ACCOUNT_CATEGORIES.map((k) => [k, r.accounts[k].id])),
    },
  }),
});

/** The day's totals from the ledger and from giving, per day and currency. */
async function summariesTx(
  tx: TenantTx,
  q: { timeZone: string; from: string; to: string },
): Promise<Map<string, DaySummary>> {
  const [ledger, giving] = await Promise.all([ledgerDailyTotalsTx(tx, q), donationDailyTotalsTx(tx, q)]);
  const out = new Map<string, DaySummary>();
  const at = (day: string, currency: string) => {
    const k = `${day}|${currency}`;
    const s = out.get(k) ?? { ...EMPTY_SUMMARY };
    out.set(k, s);
    return s as { -readonly [K in keyof DaySummary]: number };
  };
  for (const r of ledger) {
    const s = at(r.day, r.currency);
    s.salesMinor += r.salesMinor;
    s.feesMinor += r.feesMinor;
    s.refundsMinor += r.refundsMinor;
    s.payoutsMinor += r.payoutsMinor;
  }
  for (const r of giving) {
    const s = at(r.day, r.currency);
    s.donationsMinor += r.donationsMinor;
    s.refundsMinor += r.refundsMinor;
  }
  return out;
}

const PrepareResult = z.object({
  /** Journals and reversals added for sending. */
  queued: z.int(),
  /** Days that wait for an attempt whose outcome is not known yet. */
  blocked: z.int(),
  /** Why nothing was prepared (`no_map`: the accounts are not mapped yet). */
  reason: z.enum(['no_map', 'nothing_due']).nullable(),
});

/**
 * Bring the journals in line with the ledger for every day from the mapping's first day to
 * yesterday (org time zone; today is still open). A day whose totals changed after it was posted
 * gets a reversal of the journal that stands and the next revision; a re-run with the same
 * totals adds nothing (decision P6-6).
 */
export const prepareJournalsCommand = tenantCommand({
  name: 'integrations.prepareJournals',
  input: z.object({ runId: z.uuid() }),
  output: PrepareResult,
  entitlement: 'integrations',
  permission: SYNC_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const { run, connection } = await runningTx(tx, input.runId);
    if (!requireConnector(connection.connector).accounting)
      throw new DomainError('not_found', 'Unknown object');
    const map = await currentAccountMapTx(tx, connection.id);
    const accounts = map ? AccountMap.safeParse(map.accounts) : null;
    if (!map || !accounts?.success)
      return { queued: 0, blocked: 0, reason: 'no_map' as const, connectionId: connection.id };
    const timeZone = (await organizationDefaultsTx(tx, orgId))?.timezone ?? 'UTC';
    const from = map.startsOn;
    const to = addDays(dayIn(ctx.now, timeZone), -1);
    if (from > to)
      return { queued: 0, blocked: 0, reason: 'nothing_due' as const, connectionId: connection.id };
    const summaries = await summariesTx(tx, { timeZone, from, to });
    const history = await tx
      .select()
      .from(accountingJournals)
      .where(
        and(
          eq(accountingJournals.connectionId, connection.id),
          gte(accountingJournals.day, from),
          lte(accountingJournals.day, to),
        ),
      )
      .orderBy(asc(accountingJournals.id));
    const byDay = new Map<string, JournalRow[]>();
    for (const r of history) {
      const k = `${r.day}|${r.currency}`;
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
    const keys = [...new Set([...summaries.keys(), ...byDay.keys()])].sort();
    let queued = 0;
    let blocked = 0;
    for (const k of keys) {
      const [day = '', currency = ''] = k.split('|');
      const rows = byDay.get(k) ?? [];
      const summary = summaries.get(k) ?? EMPTY_SUMMARY;
      const plan = planDay(
        rows
          .filter((r) => r.status !== 'superseded')
          .map(
            (r): DayHistoryRow => ({
              id: r.id,
              kind: r.kind as DayHistoryRow['kind'],
              revision: r.revision,
              status: r.status as DayHistoryRow['status'],
              summaryKey: r.kind === 'journal' ? r.summaryKey : null,
              reversesId: r.reversesId,
              uncertain: r.uncertain,
              mapVersion: r.mapVersion,
            }),
          ),
        summary,
        map.version,
      );
      if (plan.blocked) {
        blocked += 1;
        continue;
      }
      if (plan.supersede.length) {
        await tx
          .update(accountingJournals)
          .set({ status: 'superseded', updatedAt: ctx.now })
          .where(inArray(accountingJournals.id, [...plan.supersede]));
        await resolveErrorsTx(tx, ctx, connection.id, plan.supersede.map(journalRecordKey));
      }
      if (plan.reverse) {
        const standing = rows.find((r) => r.id === plan.reverse);
        if (!standing) throw new DomainError('internal', 'Reversed journal missing');
        // A reversal that was queued before and dropped never reached the provider: it comes back
        // as it was (same revision and key).
        const dropped = rows.find((r) => r.kind === 'reversal' && r.reversesId === standing.id);
        if (dropped)
          await tx
            .update(accountingJournals)
            .set({ status: 'pending', runId: run.id, updatedAt: ctx.now })
            .where(eq(accountingJournals.id, dropped.id));
        else {
          const lines = reversalLines(parseLines(standing.lines));
          await tx.insert(accountingJournals).values({
            orgId,
            connectionId: connection.id,
            day,
            currency,
            revision: standing.revision,
            kind: 'reversal',
            reversesId: standing.id,
            summary: standing.summary,
            summaryKey: standing.summaryKey,
            lines,
            debitTotalMinor: debitTotal(lines),
            mapVersion: standing.mapVersion,
            idempotencyKey: journalKey(orgId, day, currency, standing.revision, 'reversal'),
            runId: run.id,
          });
        }
        queued += 1;
      }
      if (plan.post) {
        const revision = Math.max(0, ...rows.filter((r) => r.kind === 'journal').map((r) => r.revision)) + 1;
        const lines = journalLines(summary, accounts.data);
        await tx.insert(accountingJournals).values({
          orgId,
          connectionId: connection.id,
          day,
          currency,
          revision,
          kind: 'journal',
          summary: DaySummarySchema.parse(summary),
          summaryKey: summaryKey(summary),
          lines,
          debitTotalMinor: debitTotal(lines),
          mapVersion: map.version,
          idempotencyKey: journalKey(orgId, day, currency, revision, 'journal'),
          runId: run.id,
        });
        queued += 1;
      }
    }
    return {
      queued,
      blocked,
      reason: queued === 0 ? ('nothing_due' as const) : null,
      connectionId: connection.id,
    };
  },
  present: (r) => ({ queued: r.queued, blocked: r.blocked, reason: r.reason }),
  audit: (input, r) => ({
    action: 'integrations.accounting.prepare',
    targetType: 'integration_connection',
    targetId: r.connectionId,
    data: { runId: input.runId, queued: r.queued, blocked: r.blocked, reason: r.reason },
  }),
});

const JournalResult = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('posted'), journalId: z.uuid(), externalId: z.string().min(1).max(255) }),
  z.object({
    outcome: z.literal('failed'),
    journalId: z.uuid(),
    code: z.string().max(100),
    /** The answer may have reached the provider (timeout, 5xx, 429): the day waits for this row. */
    uncertain: z.boolean(),
  }),
]);
export type JournalResult = z.infer<typeof JournalResult>;

const errorCode = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 60) || 'error';

/** Record what the provider answered for a batch of journals (posted, or into the errors inbox). */
export const recordJournalResultsCommand = tenantCommand({
  name: 'integrations.recordJournalResults',
  input: z.object({ runId: z.uuid(), results: z.array(JournalResult).max(200) }),
  output: z.object({ posted: z.int(), failed: z.int() }),
  entitlement: 'integrations',
  permission: SYNC_PERMISSION,
  handler: async ({ input, ctx, tx }) => {
    const { run, connection } = await runningTx(tx, input.runId);
    const ids = input.results.map((r) => r.journalId);
    const rows = ids.length
      ? await tx
          .select()
          .from(accountingJournals)
          .where(and(eq(accountingJournals.connectionId, connection.id), inArray(accountingJournals.id, ids)))
          .for('update')
      : [];
    const known = new Map(rows.map((r) => [r.id, r]));
    const counts = { posted: 0, failed: 0 };
    const resolved: string[] = [];
    for (const r of input.results) {
      const row = known.get(r.journalId);
      if (!row || row.status === 'posted' || row.status === 'superseded') continue;
      if (r.outcome === 'posted') {
        await tx
          .update(accountingJournals)
          .set({
            status: 'posted',
            externalId: r.externalId,
            postedAt: ctx.now,
            attempts: row.attempts + 1,
            uncertain: false,
            lastErrorCode: null,
            runId: run.id,
            updatedAt: ctx.now,
          })
          .where(eq(accountingJournals.id, row.id));
        resolved.push(journalRecordKey(row.id));
        counts.posted += 1;
      } else {
        await tx
          .update(accountingJournals)
          .set({
            status: 'failed',
            attempts: row.attempts + 1,
            uncertain: r.uncertain,
            lastErrorCode: errorCode(r.code),
            runId: run.id,
            updatedAt: ctx.now,
          })
          .where(eq(accountingJournals.id, row.id));
        await recordErrorTx(tx, ctx, {
          connectionId: connection.id,
          runId: run.id,
          step: 'push',
          objectType: JOURNALS_OBJECT,
          direction: 'push',
          externalId: null,
          localId: row.id,
          recordKey: journalRecordKey(row.id),
          code: r.code,
          field: null,
        });
        counts.failed += 1;
      }
    }
    await resolveErrorsTx(tx, ctx, connection.id, resolved);
    await bumpRunTx(tx, ctx, run.id, { pushed: counts.posted, failed: counts.failed });
    return { ...counts, connectionId: connection.id };
  },
  present: (r) => ({ posted: r.posted, failed: r.failed }),
  audit: (input, r) => ({
    action: 'integrations.accounting.record',
    targetType: 'integration_connection',
    targetId: r.connectionId,
    data: { runId: input.runId, posted: r.posted, failed: r.failed },
  }),
});

/** Journals to send now, oldest first: pending ones, and failed ones whose retry is due (`held`: not yet). */
export async function sendableJournalsTx(
  tx: TenantTx,
  ctx: Ctx,
  connectionId: string,
): Promise<(JournalRow & { held: boolean })[]> {
  const rows = await tx
    .select()
    .from(accountingJournals)
    .where(
      and(
        eq(accountingJournals.connectionId, connectionId),
        inArray(accountingJournals.status, ['pending', 'failed']),
      ),
    )
    .orderBy(asc(accountingJournals.id));
  const failed = rows.filter((r) => r.status === 'failed').map((r) => r.id);
  const due = failed.length
    ? await tx
        .select({ localId: syncErrors.localId })
        .from(syncErrors)
        .where(
          and(
            eq(syncErrors.connectionId, connectionId),
            eq(syncErrors.status, 'open'),
            eq(syncErrors.objectType, JOURNALS_OBJECT),
            lte(syncErrors.nextRetryAt, ctx.now),
            inArray(syncErrors.localId, failed),
          ),
        )
    : [];
  const dueIds = new Set(due.map((d) => d.localId));
  // A failed row whose retry is not due holds back the rest of its day.
  return rows.map((r) => ({ ...r, held: r.status === 'failed' && !dueIds.has(r.id) }));
}

export { parseLines as parseJournalLines };
