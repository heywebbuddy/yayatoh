import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_NAME,
  keyVault,
  notSubject,
  REDACT,
  refsOf,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  collectorSubmissions,
  guests,
  importBatches,
  importRows,
  parties,
  subEventResponses,
  subEvents,
} from './schema.ts';

/** Opens a sealed JSON value of the org (the module's own sealing: key vault, org-scoped). */
async function openJson(orgId: string, ciphertext: string): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await keyVault().decrypt(orgId, ciphertext)));
  } catch {
    return null;
  }
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * The person's guest rows: linked to their contact or attendee record, or with their address in
 * the sealed answers (an import's email column, M4.1b). Plus-ones they bring are other people.
 */
async function guestIdsTx(tx: TenantTx, s: DataSubject): Promise<string[]> {
  const contacts = refsOf(s, 'contact');
  const attendees = refsOf(s, 'attendee');
  const linked =
    contacts.length || attendees.length
      ? await tx
          .select({ id: guests.id })
          .from(guests)
          .where(
            or(
              contacts.length ? inArray(guests.contactId, contacts) : undefined,
              attendees.length ? inArray(guests.attendeeId, attendees) : undefined,
            ),
          )
      : [];
  const sealed = await tx
    .select({ id: guests.id, c: guests.privateCiphertext })
    .from(guests)
    .where(isNotNull(guests.privateCiphertext));
  const byEmail: string[] = [];
  for (const g of sealed) {
    const raw = g.c ? await openJson(s.orgId, g.c) : null;
    if (raw && typeof raw === 'object' && norm((raw as { email?: unknown }).email) === s.email)
      byEmail.push(g.id);
  }
  // Resolved earlier: an attendee or contact erased before this contributor runs clears the link.
  return [...new Set([...linked.map((g) => g.id), ...byEmail, ...refsOf(s, 'guest')])];
}

/**
 * Collector submissions still waiting for the host (M4.1f) whose sealed payload gives the
 * person's address or phone. Decided submissions hold no payload (the data lives on the party).
 */
async function pendingSubmissionsTx(tx: TenantTx, s: DataSubject) {
  const phones = new Set(refsOf(s, 'phone').map(norm));
  const rows = await tx
    .select({
      id: collectorSubmissions.id,
      eventId: collectorSubmissions.eventId,
      c: collectorSubmissions.payloadCiphertext,
      createdAt: collectorSubmissions.createdAt,
    })
    .from(collectorSubmissions)
    .where(
      and(eq(collectorSubmissions.status, 'pending'), isNotNull(collectorSubmissions.payloadCiphertext)),
    );
  const hits: { id: string; eventId: string; createdAt: Date; payload: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const raw = r.c ? await openJson(s.orgId, r.c) : null;
    if (!raw || typeof raw !== 'object') continue;
    const payload = raw as Record<string, unknown>;
    if (norm(payload.email) === s.email || (phones.size > 0 && phones.has(norm(payload.phone))))
      hits.push({ id: r.id, eventId: r.eventId, createdAt: r.createdAt, payload });
  }
  return hits;
}

const fullName = (g: { firstName: string | null; lastName: string | null }) =>
  [g.firstName, g.lastName].filter(Boolean).join(' ');

/** Does a free-text value of the host's mention the person (a name of theirs, address or phone)? */
const mentions = (value: string | null, needles: readonly string[]) =>
  !!value && needles.some((n) => value.toLowerCase().includes(n.toLowerCase()));

/** Staged import rows (and headers) whose sealed cells carry the person's address or phone. */
async function stagedTx(tx: TenantTx, s: DataSubject) {
  const phones = new Set(refsOf(s, 'phone').map(norm));
  const hit = (cells: unknown) =>
    Array.isArray(cells) &&
    cells.some((c) => norm(c) === s.email || (phones.size > 0 && phones.has(norm(c))));
  const rows = await tx
    .select({ id: importRows.id, c: importRows.cellsCiphertext })
    .from(importRows)
    .where(isNotNull(importRows.cellsCiphertext));
  const rowIds: string[] = [];
  for (const r of rows)
    if (r.c && hit(((await openJson(s.orgId, r.c)) as { cells?: unknown } | null)?.cells)) rowIds.push(r.id);
  const batches = await tx
    .select({ id: importBatches.id, c: importBatches.headersCiphertext })
    .from(importBatches)
    .where(isNotNull(importBatches.headersCiphertext));
  const batchIds: string[] = [];
  for (const b of batches)
    if (b.c && hit(((await openJson(s.orgId, b.c)) as { headers?: unknown } | null)?.headers))
      batchIds.push(b.id);
  return { rowIds, batchIds };
}

/**
 * guests' part of a data-subject request (M6.1c). The person's guest rows are redacted in place
 * (the host's head count, seating and plus-ones depend on them): name, meal and the sealed
 * answers go, and the links to their contact and attendee records are cleared. Their party keeps
 * its other guests; its name, envelope name, tags and notes lose any mention of the person.
 * Staged import rows (and a header row) carrying their address or phone lose their sealed cells.
 * The append-only RSVP history holds field names and ids only (no personal values).
 */
export const guestsDataSubjects = defineDataSubjectContributor({
  module: 'guests',
  tables: {
    'guests.guests': REDACT,
    'guests.parties': REDACT,
    'guests.import_rows': REDACT,
    'guests.import_batches': REDACT,
    'guests.collector_submissions': DELETE,
    // Batch 3j merge (M4.5a): the hosts' own website copy, written by the organizer about its
    // event; it is not a guest's record (guests' names never appear on it).
    'guests.sites': notSubject("the hosts' website title and intro, written by the organizer"),
    'guests.site_blocks': notSubject("the hosts' website sections (program, travel, registry, FAQ)"),
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const ids = await guestIdsTx(tx, s);
    if (ids.length === 0) return {};
    const rows = await tx
      .select({ firstName: guests.firstName, lastName: guests.lastName })
      .from(guests)
      .where(inArray(guests.id, ids));
    return { guest: ids, name: rows.map(fullName).filter((n) => n.length > 0) };
  },
  async export(tx, s): Promise<SubjectExport> {
    const ids = await guestIdsTx(tx, s);
    // Sealed answers (dietary, accessibility, address) stay sealed: no export helper opens them.
    const rows = await tx
      .select({
        eventId: guests.eventId,
        partyName: parties.name,
        envelopeName: parties.envelopeName,
        kind: guests.kind,
        firstName: guests.firstName,
        lastName: guests.lastName,
        ageClass: guests.ageClass,
        meal: guests.meal,
        isPrimary: guests.isPrimary,
        createdAt: guests.createdAt,
      })
      .from(guests)
      .innerJoin(parties, eq(parties.id, guests.partyId))
      .where(ids.length ? inArray(guests.id, ids) : sql`false`)
      .orderBy(asc(guests.createdAt));
    const responses = await tx
      .select({
        eventId: subEventResponses.eventId,
        subEvent: subEvents.name,
        startsAt: subEvents.startsAt,
        status: subEventResponses.status,
        source: subEventResponses.source,
        recordedAt: subEventResponses.updatedAt,
      })
      .from(subEventResponses)
      .innerJoin(subEvents, eq(subEvents.id, subEventResponses.subEventId))
      .where(ids.length ? inArray(subEventResponses.guestId, ids) : sql`false`)
      .orderBy(asc(subEvents.startsAt));
    const submissions = (await pendingSubmissionsTx(tx, s)).map((x) => ({
      eventId: x.eventId,
      submittedAt: x.createdAt,
      household: x.payload.household ?? null,
      members: x.payload.members ?? [],
      address: x.payload.address ?? null,
      email: x.payload.email ?? null,
      phone: x.payload.phone ?? null,
      note: x.payload.note ?? null,
    }));
    return { sections: { guests: rows, responses, collectorSubmissions: submissions } };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const now = ctx.now;
    const ids = await guestIdsTx(tx, s);
    const mine = ids.length
      ? await tx
          .select({ partyId: guests.partyId, firstName: guests.firstName, lastName: guests.lastName })
          .from(guests)
          .where(inArray(guests.id, ids))
      : [];
    const needles = [
      ...new Set(
        [
          s.email,
          ...refsOf(s, 'phone'),
          ...refsOf(s, 'name'),
          ...mine.flatMap((g) => [fullName(g), g.lastName ?? '']),
        ]
          .map((n) => n.trim())
          .filter((n) => n.length >= 4 && n !== ERASED_NAME),
      ),
    ];
    const named = ids.length
      ? await tx
          .update(guests)
          .set({
            firstName: ERASED_NAME,
            lastName: null,
            meal: null,
            privateCiphertext: null,
            contactId: null,
            attendeeId: null,
            updatedAt: now,
          })
          .where(and(inArray(guests.id, ids), eq(guests.kind, 'guest')))
          .returning({ id: guests.id })
      : [];
    const plusOnes = ids.length
      ? await tx
          .update(guests)
          .set({
            firstName: null,
            lastName: null,
            meal: null,
            privateCiphertext: null,
            contactId: null,
            attendeeId: null,
            updatedAt: now,
          })
          .where(and(inArray(guests.id, ids), eq(guests.kind, 'plus_one')))
          .returning({ id: guests.id })
      : [];
    const partyIds = [...new Set(mine.map((g) => g.partyId))];
    const partyRows = partyIds.length
      ? await tx.select().from(parties).where(inArray(parties.id, partyIds))
      : [];
    let partiesChanged = 0;
    for (const p of partyRows) {
      const tags = p.tags.filter((t) => !mentions(t, needles));
      const next = {
        name: mentions(p.name, needles) ? ERASED_NAME : p.name,
        envelopeName: mentions(p.envelopeName, needles) ? null : p.envelopeName,
        notes: mentions(p.notes, needles) ? '' : p.notes,
        tags,
      };
      if (
        next.name === p.name &&
        next.envelopeName === p.envelopeName &&
        next.notes === p.notes &&
        tags.length === p.tags.length
      )
        continue;
      await tx
        .update(parties)
        .set({ ...next, updatedAt: now })
        .where(eq(parties.id, p.id));
      partiesChanged += 1;
    }
    const staged = await stagedTx(tx, s);
    const rows = staged.rowIds.length
      ? await tx
          .update(importRows)
          .set({ cellsCiphertext: null, updatedAt: now })
          .where(inArray(importRows.id, staged.rowIds))
          .returning({ id: importRows.id })
      : [];
    const headers = staged.batchIds.length
      ? await tx
          .update(importBatches)
          .set({ headersCiphertext: null, updatedAt: now })
          .where(and(inArray(importBatches.id, staged.batchIds), isNull(importBatches.purgedAt)))
          .returning({ id: importBatches.id })
      : [];
    // Submissions still waiting for the host: deleted (nothing reached the guest list yet).
    const pending = (await pendingSubmissionsTx(tx, s)).map((x) => x.id);
    const submissions = pending.length
      ? await tx
          .delete(collectorSubmissions)
          .where(inArray(collectorSubmissions.id, pending))
          .returning({ id: collectorSubmissions.id })
      : [];
    return {
      erased: {
        'guests.collector_submissions': submissions.length,
        'guests.guests': named.length + plusOnes.length,
        'guests.parties': partiesChanged,
        'guests.import_rows': rows.length,
        'guests.import_batches': headers.length,
      },
    };
  },
});
