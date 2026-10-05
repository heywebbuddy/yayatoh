import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type CatalogEntry,
  EVENT_CATALOG,
  EVENT_GROUPS,
  entryForSource,
  envelope,
  exampleEnvelope,
  PUBLIC_SOURCES,
  SUBSCRIBABLE_EVENT_TYPES,
  THIN_FIELDS,
  toPublicData,
  WebhookEnvelopeBase,
} from '../src/catalog.ts';
import { INTERNAL_EVENTS } from '../src/internal-events.ts';

const ORDER_ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a91';
const EVENT_ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a92';
const TICKET_ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a93';
const ORG_ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a94';
const ROOT = join(import.meta.dirname, '../../../..');
const entries = EVENT_CATALOG as readonly CatalogEntry[];

/** Every source file of the platform's apps and packages (no tests, no node_modules). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'tests' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && p.includes(`${'/src/'}`)) out.push(p);
  }
  return out;
}

/**
 * The outbox events the code emits (`type: 'x.y', version: N`) and the `x.y@N` keys subscribers
 * and helpers name (events emitted through a helper, such as campaigns', show up there).
 */
function outboxKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const f of [...sourceFiles(join(ROOT, 'packages')), ...sourceFiles(join(ROOT, 'apps'))]) {
    if (f.includes('/modules/webhooks/')) continue;
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/type:\s*'([a-z][a-z0-9_.]*)',\s*version:\s*(\d+)/g))
      keys.set(`${m[1]}@${m[2]}`, relative(ROOT, f));
    for (const m of s.matchAll(/'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)@(\d+)'/g))
      keys.set(`${m[1]}@${m[2]}`, relative(ROOT, f));
  }
  return keys;
}

describe('event catalog coverage', () => {
  const keys = outboxKeys();

  it('finds the outbox events (sanity: the scan works)', () => {
    expect(keys.size).toBeGreaterThan(100);
    expect(keys.has('order.paid@1')).toBe(true);
    expect(keys.has('campaigns.send_completed@1')).toBe(true);
  });

  it('classifies every outbox event as public (catalog) or internal, never both', () => {
    const unclassified = [...keys.keys()].filter(
      (k) => !PUBLIC_SOURCES.includes(k) && !(k in INTERNAL_EVENTS),
    );
    expect(unclassified.map((k) => `${k} (${keys.get(k)})`)).toEqual([]);
    expect(PUBLIC_SOURCES.filter((k) => k in INTERNAL_EVENTS)).toEqual([]);
  });

  it('every catalog source and internal entry is a real outbox event', () => {
    expect(PUBLIC_SOURCES.filter((k) => !keys.has(k))).toEqual([]);
    expect(Object.keys(INTERNAL_EVENTS).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('documents every public event: description, versioned schema and an example that fits', () => {
    for (const e of entries) {
      expect(e.summary.length, e.type).toBeGreaterThan(10);
      expect(e.description.length, e.type).toBeGreaterThan(10);
      expect(Number.isInteger(e.version) && e.version >= 1, e.type).toBe(true);
      expect(EVENT_GROUPS).toContain(e.group);
      expect(e.schemaName).toMatch(new RegExp(`V${e.version}$`));
      expect(e.schema.safeParse(e.example).success, e.type).toBe(true);
      // The example envelope is what the docs and test sends show.
      const env = exampleEnvelope(e);
      expect(WebhookEnvelopeBase.safeParse(env).success, e.type).toBe(true);
    }
  });

  it('types and schema names are unique; one entry per source', () => {
    const typeVersions = entries.map((e) => `${e.type}@${e.version}`);
    expect(new Set(typeVersions).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.schemaName)).size).toBe(entries.length);
    const sources = entries.flatMap((e) => (e.source ? [e.source] : []));
    expect(new Set(sources).size).toBe(sources.length);
    for (const s of sources) expect(entryForSource(s)?.source).toBe(s);
  });

  it('meta events are not subscribable; every other type is', () => {
    expect(SUBSCRIBABLE_EVENT_TYPES).not.toContain('webhook.test');
    expect(SUBSCRIBABLE_EVENT_TYPES.length).toBe(entries.filter((e) => e.group !== 'meta').length);
  });
});

/** Walk a JSON Schema and yield every (path, node). */
function* walk(node: unknown, path: string[] = []): Generator<[string[], Record<string, unknown>]> {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  yield [path, n];
  for (const [k, v] of Object.entries(n)) {
    if (Array.isArray(v)) for (const [i, x] of v.entries()) yield* walk(x, [...path, k, String(i)]);
    else if (v && typeof v === 'object') yield* walk(v, [...path, k]);
  }
}

describe('thin payloads (D21)', () => {
  it('uses only thin field names', () => {
    for (const e of entries)
      for (const key of Object.keys(e.schema.shape))
        expect(THIN_FIELDS as readonly string[], `${e.type}.${key}`).toContain(key);
  });

  it('has no free-text strings: every string is a uuid, date, date-time, enum, constant or short pattern', () => {
    for (const e of entries) {
      const schema = z.toJSONSchema(e.schema, { io: 'output' });
      for (const [path, n] of walk(schema)) {
        if (n.type !== 'string') continue;
        const bounded =
          ['uuid', 'date', 'date-time'].includes(String(n.format)) ||
          Array.isArray(n.enum) ||
          'const' in n ||
          (typeof n.pattern === 'string' && /\{\d+(,\d+)?\}|\^\[A-Z\]\{3\}\$/.test(n.pattern));
        expect(bounded, `${e.type} ${path.join('.')}: ${JSON.stringify(n)}`).toBe(true);
      }
      expect(schema.additionalProperties, e.type).not.toBe(true);
    }
  });

  // The leak canary: internal payloads stuffed with a person's details. Nothing of it may reach
  // the public data, whatever the internal event carries next to the fields we publish.
  const CANARY = {
    email: 'canary.person@leak.example',
    name: 'Canary Q. Person',
    phone: '+15555550123',
    address: '1 Canary Lane, Springfield',
    note: 'CANARY_NOTE_do_not_publish',
    answer: 'CANARY_ANSWER_secret',
  };
  const canaryPayload = (e: CatalogEntry) => ({
    // What the internal event carries: the public fields (under their internal names)…
    ...(e.example as Record<string, unknown>),
    ...(e.source === 'form.registration_submitted@1' ? { version: 3 } : {}),
    ...(e.source === 'program.agenda.published@1'
      ? { version: 2, sessions: 14, publishedAt: '2030-03-01T23:04:11.000Z' }
      : {}),
    // …and whatever else a module might put next to them.
    orgId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a7f',
    contactId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a70',
    buyerEmail: CANARY.email,
    holderName: CANARY.name,
    phone: CANARY.phone,
    address: CANARY.address,
    note: CANARY.note,
    answers: { q1: CANARY.answer },
    holder: { name: CANARY.name, email: CANARY.email },
  });

  it('a payload stuffed with personal data publishes none of it', () => {
    for (const e of entries.filter((x) => x.source)) {
      const data = toPublicData(e, canaryPayload(e));
      const json = JSON.stringify(
        envelope(e, { id: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a80', orgId: 'o', occurredAt: 'now' }, data),
      );
      for (const v of Object.values(CANARY)) expect(json, `${e.type} leaked ${v}`).not.toContain(v);
      expect(json).not.toContain('contactId');
      for (const k of Object.keys(data)) expect(THIN_FIELDS as readonly string[]).toContain(k);
    }
  });

  it('accepts every way the orders module says an order was paid (batch 3i: M5.1d invoices)', () => {
    const paid = entryForSource('order.paid@1') as CatalogEntry;
    const dir = join(ROOT, 'packages/modules/orders/src');
    const emitted = new Set<string>();
    for (const f of sourceFiles(dir)) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/type: 'order\.paid',[\s\S]{0,400}?via: '([a-z_]+)'/g))
        emitted.add(m[1] as string);
    }
    expect([...emitted].sort()).toEqual(expect.arrayContaining(['box_office', 'free', 'invoice']));
    for (const via of [...emitted, 'fake', 'stripe'])
      expect(() => toPublicData(paid, { ...(paid.example as object), via }), via).not.toThrow();
  });

  it('tickets.cancelled carries a bulk operation or a voided invoice (batch 3i: M5.1d), never neither', () => {
    const cancelled = entryForSource('tickets.cancelled@1') as CatalogEntry;
    const base = { eventId: EVENT_ID, ticketIds: [TICKET_ID] };
    expect(toPublicData(cancelled, { ...base, orderId: ORDER_ID, orgId: ORG_ID })).toEqual({
      ...base,
      orderId: ORDER_ID,
    });
    expect(toPublicData(cancelled, { ...base, operationId: ORDER_ID })).toEqual({
      ...base,
      operationId: ORDER_ID,
    });
    expect(() => toPublicData(cancelled, base)).toThrow();
  });

  it('refuses a payload whose published fields carry free text instead of sending it', () => {
    const paid = entryForSource('order.paid@1') as CatalogEntry;
    expect(() => toPublicData(paid, { ...(paid.example as object), via: CANARY.email })).toThrow();
    const created = entryForSource('event.created@1') as CatalogEntry;
    expect(() => toPublicData(created, { ...(created.example as object), slug: CANARY.name })).toThrow();
    const updated = entryForSource('event.updated@1') as CatalogEntry;
    expect(() =>
      toPublicData(updated, {
        eventId: (updated.example as { eventId: string }).eventId,
        fields: [CANARY.address],
      }),
    ).toThrow();
  });

  it('maps renamed fields explicitly (form version, agenda version)', () => {
    const form = entryForSource('form.registration_submitted@1') as CatalogEntry;
    expect(
      toPublicData(form, {
        orgId: 'x',
        respondentId: (form.example as { respondentId: string }).respondentId,
        eventId: null,
        registrationTypeId: null,
        version: 4,
      }),
    ).toMatchObject({ formVersion: 4, eventId: null });
    const agenda = entryForSource('program.agenda.published@1') as CatalogEntry;
    expect(
      toPublicData(agenda, {
        eventId: (agenda.example as { eventId: string }).eventId,
        version: 3,
        sessions: 9,
        publishedAt: '2030-03-01T23:04:11.000Z',
      }),
    ).toEqual({
      eventId: (agenda.example as { eventId: string }).eventId,
      agendaVersion: 3,
      sessions: 9,
      publishedAt: '2030-03-01T23:04:11.000Z',
    });
  });
});
