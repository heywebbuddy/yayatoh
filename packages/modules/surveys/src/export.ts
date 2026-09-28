import { attendeesForExportTx } from '@yayatoh/attendees';
import { csvRow } from '@yayatoh/csv';
import { findEventTx } from '@yayatoh/events';
import { subjectResponsesTx } from '@yayatoh/forms';
import { DomainError } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction } from '@yayatoh/platform';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { answerCell } from './domain/report.ts';
import { surveyInvitations } from './schema.ts';
import { formSubject, respondedInvitationIdsTx, surveyTx } from './surveys.ts';

const Text = z.string().trim().min(1).max(60);

/** The fixed columns; one column per question follows (its label). Headers come from the requester's UI. */
export const SURVEY_EXPORT_COLUMNS = ['name', 'email', 'submittedAt'] as const;

const ExportParams = z.object({
  headers: z.object({ name: Text, email: Text, submittedAt: Text }),
  yes: Text,
  no: Text,
});

/** `YYYY-MM-DD HH:mm` in the event's timezone. */
function localStamp(d: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * A survey's responses as CSV: the respondent (name, email: contact data, so `attendees:export`
 * and step-up like every export), when they answered (event timezone), then one column per
 * question. Written chunk by chunk into the operation's file; the start is audited (`bulk.start`).
 */
export const surveyExportAction = defineBulkAction({
  key: 'surveys.responsesCsv',
  entitlement: 'messaging',
  permission: 'attendees:export',
  params: ExportParams,
  filter: z.object({ surveyId: z.uuid() }),
  chunkSize: 1_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `survey-responses-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: async (tx, sel) => {
    if (!sel.eventId || !sel.filter) throw new DomainError('validation_failed', 'A survey is required');
    const ids = await respondedInvitationIdsTx(tx, sel.eventId, sel.filter.surveyId);
    if (sel.ids) {
      const ok = new Set(ids);
      return sel.ids.filter((id) => ok.has(id));
    }
    return ids;
  },
  run: async (tx, _ctx, ids, params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const event = await findEventTx(tx, meta.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const invites = ids.length
      ? await tx
          .select()
          .from(surveyInvitations)
          .where(inArray(surveyInvitations.id, [...ids]))
      : [];
    const surveyId = invites[0]?.surveyId;
    if (!surveyId) return { results: ids.map((id) => ({ id, ok: false, code: 'not_found' })) };
    await surveyTx(tx, meta.eventId, surveyId);
    const { questions, responses } = await subjectResponsesTx(tx, formSubject(surveyId), ids);
    const byInvite = new Map(responses.map((r) => [r.respondentId, r]));
    const people = new Map(
      (await attendeesForExportTx(tx, [...new Set(invites.map((i) => i.attendeeId))])).map((a) => [a.id, a]),
    );
    const inviteById = new Map(invites.map((i) => [i.id, i]));
    // Excel opens UTF-8 correctly only with a byte-order mark.
    let out = meta.first
      ? `﻿${csvRow([params.headers.name, params.headers.email, params.headers.submittedAt, ...questions.map((q) => q.label)])}`
      : '';
    const results = [];
    for (const id of ids) {
      const inv = inviteById.get(id);
      const r = byInvite.get(id);
      if (!inv || inv.surveyId !== surveyId || !r) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      const a = people.get(inv.attendeeId);
      out += csvRow([
        a?.name ?? '',
        a?.email ?? '',
        localStamp(inv.respondedAt ?? r.at, event.timezone),
        ...questions.map((q) => answerCell(q, r.answers[q.key], params)),
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const surveyExportBulk = bulkCommands(surveyExportAction);
