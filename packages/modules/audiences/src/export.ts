import { SegmentDefinition, segmentContactIdsTx, segmentExportRowsTx } from '@yayatoh/crm';
import { csvRow } from '@yayatoh/csv';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction, MAX_BULK_ITEMS } from '@yayatoh/platform';
import { organizationDefaultsTx } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { compileForOrgTx } from './scopes.ts';
import { segmentDefinitionTx } from './segments.ts';

export const AUDIENCE_EXPORT_COLUMNS = [
  'name',
  'email',
  'events',
  'eventsAttended',
  'tickets',
  'firstSeen',
  'lastSeen',
  'emailConsent',
  'smsConsent',
] as const;
export const CONSENT_WORDS = ['granted', 'withdrawn', 'unknown_legacy', 'none'] as const;

const Text = z.string().trim().min(1).max(60);

/** Localized headers and consent words come from the requester's UI (the file reads in their language). */
const ExportParams = z.object({
  headers: z.object(
    Object.fromEntries(AUDIENCE_EXPORT_COLUMNS.map((c) => [c, Text])) as Record<
      (typeof AUDIENCE_EXPORT_COLUMNS)[number],
      typeof Text
    >,
  ),
  consent: z.object(
    Object.fromEntries(CONSENT_WORDS.map((c) => [c, Text])) as Record<
      (typeof CONSENT_WORDS)[number],
      typeof Text
    >,
  ),
});

/** "Everything matching" is a saved audience or a definition from the builder. */
const ExportFilter = z.union([
  z.object({ segmentId: z.uuid() }).strict(),
  z.object({ definition: SegmentDefinition }).strict(),
]);

/** `YYYY-MM-DD` in the org's timezone. */
const localDay = (d: Date | null, timeZone: string) =>
  d
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d)
    : '';

/**
 * An audience as CSV (M3.6), through the platform bulk-export path: starting it needs a fresh
 * step-up, it is audited (`bulk.start`), refused while staff act as a member (category `export`),
 * and the file is written chunk by chunk from an allowlist of columns. The selection is the
 * audience's members when it starts (snapshotted into the operation). Contact data leaving the
 * platform needs `attendees:export` (pending owner: a marketing-only export permission).
 */
export const audienceExportAction = defineBulkAction({
  key: 'audiences.contactsCsv',
  entitlement: 'marketing',
  permission: 'attendees:export',
  params: ExportParams,
  filter: ExportFilter,
  chunkSize: 1_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `audience-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: async (tx, sel) => {
    if (sel.ids) throw new DomainError('validation_failed', 'Export an audience, not a hand-picked list');
    const f = sel.filter;
    if (!f) throw new DomainError('validation_failed', 'An audience is required');
    const def = 'segmentId' in f ? await segmentDefinitionTx(tx, f.segmentId) : f.definition;
    const [org] = await tx.execute<{ org_id: string }>(
      // The tenant of this transaction (RLS context), never taken from input.
      sql`select current_setting('app.org_id') as org_id`,
    );
    if (!org) throw new DomainError('internal');
    const where = await compileForOrgTx(tx, org.org_id, def, sel.eventId);
    return segmentContactIdsTx(tx, where, MAX_BULK_ITEMS + 1);
  },
  run: async (tx, ctx, ids, params, meta) => {
    const tz = (await organizationDefaultsTx(tx, requireOrg(ctx)))?.timezone ?? 'UTC';
    const rows = await segmentExportRowsTx(tx, ids);
    const byId = new Map(rows.map((r) => [r.contactId, r]));
    const word = (s: string) => params.consent[s as (typeof CONSENT_WORDS)[number]] ?? params.consent.none;
    // Excel opens UTF-8 correctly only with a byte-order mark.
    let out = meta.first ? `﻿${csvRow(AUDIENCE_EXPORT_COLUMNS.map((c) => params.headers[c]))}` : '';
    const results = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      out += csvRow([
        r.name,
        r.email,
        String(r.events),
        String(r.eventsAttended),
        String(r.tickets),
        localDay(r.firstSeenAt, tz),
        localDay(r.lastSeenAt, tz),
        word(r.emailConsent),
        word(r.smsConsent),
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const audienceExportBulk = bulkCommands(audienceExportAction);
