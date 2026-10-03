import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { compileSegment, type ResolvedScopes } from '../src/segments/compile.ts';
import {
  emptySegment,
  MAX_SEGMENT_CONDITIONS,
  SegmentDefinition,
  scopeKey,
  segmentScopes,
  usesProfileConditions,
} from '../src/segments/dsl.ts';

const E1 = '0190a3f0-0000-7000-8000-000000000001';
const E2 = '0190a3f0-0000-7000-8000-000000000002';
const T1 = '0190a3f0-0000-7000-8000-0000000000a1';
const S1 = '0190a3f0-0000-7000-8000-0000000000b1';
const dialect = new PgDialect();

const part = (extra: Record<string, unknown> = {}) => ({
  type: 'participation',
  scope: { kind: 'event', eventId: E1 },
  ...extra,
});
const def = (conditions: unknown[], op: 'and' | 'or' = 'and') => ({
  version: 1,
  root: { type: 'group', op, conditions },
});
const parse = (v: unknown) => SegmentDefinition.parse(v);
const scopes = (d: SegmentDefinition, ids: Record<string, readonly string[] | null> = {}): ResolvedScopes =>
  new Map(segmentScopes(d).map((s) => [scopeKey(s), ids[scopeKey(s)] ?? [E1]]));
const render = (d: SegmentDefinition, opts: Partial<Parameters<typeof compileSegment>[1]> = {}) =>
  dialect.sqlToQuery(compileSegment(d, { scopes: scopes(d), timezone: 'America/Chicago', ...opts }));

describe('segment DSL validation', () => {
  it('fills defaults and accepts the three template shapes', () => {
    const d = parse(def([part({ ticketTypeIds: [T1], seated: false })]));
    const c = d.root.conditions[0];
    expect(c).toMatchObject({ negate: false, role: 'attendee', checkedIn: null, seated: false });
    expect(parse(emptySegment())).toEqual(emptySegment());
  });

  it('rejects unknown keys, types, operators and malformed values', () => {
    for (const bad of [
      def([{ type: 'sql', value: '1=1' }]),
      def([part({ extra: true })]),
      def([part({ scope: { kind: 'event', eventId: "x' or 1=1 --" } })]),
      def([part({ scope: { kind: 'everything' } })]),
      def([{ type: 'spend', scope: { kind: 'any' }, currency: 'usd', op: 'gte', amountMinor: 1 }]),
      def([{ type: 'spend', scope: { kind: 'any' }, currency: 'USD', op: '>= 0 or true', amountMinor: 1 }]),
      def([{ type: 'spend', scope: { kind: 'any' }, currency: 'USD', op: 'gte', amountMinor: 1.5 }]),
      def([{ type: 'totals', metric: 'events; drop table x', op: 'gte', value: 1 }]),
      def([{ type: 'seen', which: 'last', from: null, to: null }]),
      def([{ type: 'seen', which: 'last', from: '2028-02-30', to: null }]),
      def([part({ registeredFrom: '2028-05-02', registeredTo: '2028-05-01' })]),
      def([{ type: 'label', scope: { kind: 'any' }, label: '   ' }]),
      def([{ type: 'label', scope: { kind: 'any' }, label: 'x'.repeat(41) }]),
      def([part({ ticketTypeIds: Array.from({ length: 21 }, () => T1) })]),
      { version: 2, root: { type: 'group', op: 'and', conditions: [] } },
      { version: 1, root: { type: 'group', op: 'xor', conditions: [] } },
      { version: 1, root: part() },
    ])
      expect(SegmentDefinition.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('limits nesting depth and the number of conditions', () => {
    const g = (conditions: unknown[]) => ({ type: 'group', op: 'or', conditions });
    expect(SegmentDefinition.safeParse(def([g([g([part()])])])).success).toBe(true);
    expect(SegmentDefinition.safeParse(def([g([g([g([part()])])])])).success).toBe(false);
    const many = Array.from({ length: MAX_SEGMENT_CONDITIONS + 1 }, () => part());
    const split = def([g(many.slice(0, 16)), g(many.slice(16))]);
    expect(SegmentDefinition.safeParse(split).success).toBe(false);
    const ok = def([g(many.slice(0, 15)), g(many.slice(15, MAX_SEGMENT_CONDITIONS))]);
    expect(SegmentDefinition.safeParse(ok).success).toBe(true);
  });

  it('lists scopes and profile conditions', () => {
    const d = parse(
      def([
        part(),
        { type: 'label', scope: { kind: 'series', seriesId: S1 }, label: 'vip' },
        { type: 'totals', metric: 'events', op: 'gte', value: 2 },
      ]),
    );
    expect(segmentScopes(d).map(scopeKey)).toEqual([`event:${E1}`, `series:${S1}`]);
    expect(usesProfileConditions(d)).toBe(true);
    expect(usesProfileConditions(parse(def([part()])))).toBe(false);
  });
});

describe('segment compilation', () => {
  it('binds every value as a parameter (injection attempts stay data)', () => {
    const evil = "vip' or 1=1; drop table crm.contacts; --";
    const d = parse(
      def([
        { type: 'label', scope: { kind: 'any' }, label: evil },
        {
          type: 'spend',
          scope: { kind: 'event', eventId: E1 },
          currency: 'USD',
          op: 'gte',
          amountMinor: 5000,
        },
        part({ ticketTypeIds: [T1], registeredFrom: '2028-01-01' }),
      ]),
    );
    const q = render(d, {
      scopes: new Map([
        ['any', null],
        [`event:${E1}`, [E1]],
      ]),
    });
    expect(q.sql).not.toContain('drop table');
    expect(q.sql).not.toContain(E1);
    expect(q.sql).not.toContain(T1);
    expect(q.sql).not.toContain('USD');
    expect(q.params).toContain(evil.trim().replace(/\s+/g, ' '));
    expect(q.params).toEqual(expect.arrayContaining([E1, T1, 'USD', 5000, '2028-01-01', 'America/Chicago']));
  });

  it('maps operators, metrics and channels from fixed tables', () => {
    const d = parse(
      def(
        [
          { type: 'totals', metric: 'eventsAttended', op: 'lt', value: 3 },
          { type: 'consent', channel: 'sms', granted: false },
          { type: 'seen', which: 'first', from: '2027-01-01', to: null },
        ],
        'or',
      ),
    );
    const q = render(d);
    expect(q.sql).toContain('coalesce(pr.events_attended, 0) <');
    expect(q.sql).toContain("coalesce(pr.sms_consent, 'none') <> 'granted'");
    expect(q.sql).toContain('pr.first_seen_at >=');
    expect(q.sql).toContain(' or ');
  });

  it('negates participation, and an empty group places no restriction', () => {
    const q = render(parse(def([part({ negate: true, checkedIn: true, role: 'buyer' })])));
    expect(q.sql).toContain('not exists (select 1 from crm.event_participation p');
    expect(q.sql).toContain('p.orders > 0');
    expect(q.sql).toContain('p.checked_in = $');
    const empty = render(parse(emptySegment()));
    expect(empty.sql).toContain('c.merged_into is null');
    expect(empty.sql).toMatch(/and true$/);
  });

  it('always excludes merged and erased contacts', () => {
    const q = render(parse(def([part()])));
    expect(q.sql).toContain("c.email_norm not like '%@erased.invalid'");
  });

  it('resolves scopes: every event, some events or none', () => {
    const anyScope = parse(def([part({ scope: { kind: 'any' } })]));
    expect(render(anyScope, { scopes: new Map([['any', null]]) }).sql).toContain('and true and p.registered');
    const none = parse(def([part({ scope: { kind: 'previousEdition', eventId: E2 } })]));
    expect(render(none, { scopes: new Map([[`previousEdition:${E2}`, []]]) }).sql).toContain('and false and');
    expect(() => compileSegment(none, { scopes: new Map(), timezone: 'UTC' })).toThrow(/Unresolved/);
  });

  it('adds the event restriction for event-scoped access', () => {
    const q = render(parse(emptySegment()), { restrictToEventId: E2 });
    expect(q.sql).toContain('p.event_id = $1');
    expect(q.params[0]).toBe(E2);
  });
});

describe('engagement condition (M5.7b)', () => {
  const eng = (extra: Record<string, unknown> = {}) => ({
    type: 'engagement',
    scope: { kind: 'event', eventId: E1 },
    op: 'gte',
    value: 21,
    ...extra,
  });

  it('validates a whole score from 0 to the cap with a fixed operator', () => {
    expect(parse(def([eng()])).root.conditions[0]).toMatchObject({ type: 'engagement', value: 21 });
    for (const bad of [{ value: -1 }, { value: 1.5 }, { value: 1_000_001 }, { op: 'like' }, { extra: true }])
      expect(SegmentDefinition.safeParse(def([eng(bad)])).success).toBe(false);
  });

  it('sums the scores over the events in scope, value bound as a parameter', () => {
    const q = render(parse(def([eng({ op: 'lt', value: 7 })])));
    expect(q.sql).toContain('(select coalesce(sum(p.score), 0) from crm.event_engagement p');
    expect(q.sql).toContain('p.contact_id = c.id and p.event_id = any(');
    expect(q.sql).toMatch(/\) < \$\d+/);
    expect(q.params).toEqual(expect.arrayContaining([E1, 7]));
  });

  it('is scoped like the other event conditions and is not a profile condition', () => {
    const d = parse(def([eng({ scope: { kind: 'series', seriesId: S1 } })]));
    expect(segmentScopes(d)).toEqual([{ kind: 'series', seriesId: S1 }]);
    expect(usesProfileConditions(d)).toBe(false);
    expect(render(d, { scopes: new Map([[`series:${S1}`, []]]) }).sql).toContain('and false)');
  });
});
