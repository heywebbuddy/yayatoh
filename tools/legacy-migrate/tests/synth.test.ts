import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isInsert,
  parseCreateTable,
  parseInsert,
  type SqlValue,
  StatementSplitter,
} from '@yayatoh/legacy-mask';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailNorm } from '../src/ids.ts';
import { generateDumpFile, SYNTHETIC_MARKER, type SynthSummary } from '../src/synth/generate.ts';

const dir = mkdtempSync(join(tmpdir(), 'synth-test-'));
const dumps: Record<string, { text: string; summary: SynthSummary }> = {};

function rowsOf(text: string): Map<string, Record<string, string | null>[]> {
  const s = new StatementSplitter();
  const stmts = s.push(text);
  const cols = new Map<string, string[]>();
  const out = new Map<string, Record<string, string | null>[]>();
  const val = (v: SqlValue) => (v.kind === 'null' ? null : v.kind === 'str' ? v.value : v.raw);
  for (const st of stmts) {
    const def = parseCreateTable(st);
    if (def)
      cols.set(
        def.name,
        def.columns.map((c) => c.name),
      );
    else if (isInsert(st)) {
      const ins = parseInsert(st);
      const names = cols.get(ins.table) ?? [];
      const list = out.get(ins.table) ?? [];
      for (const r of ins.rows)
        list.push(Object.fromEntries(names.map((n, i) => [n, val(r[i] ?? { kind: 'null' })])));
      out.set(ins.table, list);
    }
  }
  return out;
}

beforeAll(async () => {
  for (const [name, opts] of [
    ['yay', { instance: 'yay', scale: 'small', demo: true }],
    ['abc', { instance: 'abc', scale: 'small' }],
    ['yay2', { instance: 'yay', scale: 'small', demo: true }],
  ] as const) {
    const path = join(dir, `${name}.sql`);
    const summary = await generateDumpFile(path, opts);
    dumps[name] = { text: readFileSync(path, 'utf8'), summary };
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('synthetic legacy generator', () => {
  it('is deterministic: the same options give byte-identical dumps', () => {
    expect(dumps.yay2?.text).toBe(dumps.yay?.text);
    expect(dumps.abc?.text).not.toBe(dumps.yay?.text);
  });

  it('is marked synthetic and uses reserved example domains only', () => {
    for (const { text } of Object.values(dumps)) {
      expect(text).toContain(SYNTHETIC_MARKER);
      const domains = [...text.matchAll(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map((m) =>
        (m[1] ?? '').toLowerCase(),
      );
      expect(domains.length).toBeGreaterThan(50);
      for (const d of domains) expect(d).toMatch(/(^|\.)example\.(com|org|net)$|(^|\.)test$/);
    }
  });

  it('parses with the legacy-mask reader with the row counts it reports', () => {
    for (const { text, summary } of Object.values(dumps)) {
      const rows = rowsOf(text);
      for (const [table, n] of Object.entries(summary.rows))
        expect(rows.get(table)?.length ?? 0, table).toBe(n);
    }
  });

  it('groups bookings by common_order with transactions summing their net prices', () => {
    const rows = rowsOf(dumps.yay?.text ?? '');
    const bookings = rows.get('bookings') ?? [];
    const byOrder = new Map<string, Record<string, string | null>[]>();
    for (const b of bookings.filter((x) => !x.distributed_from_booking_id))
      byOrder.set(b.common_order as string, [...(byOrder.get(b.common_order as string) ?? []), b]);
    expect([...byOrder.values()].some((g) => g.length > 1)).toBe(true);
    for (const t of rows.get('transactions') ?? []) {
      const group = byOrder.get(t.order_number as string) ?? [];
      const sum = group.reduce((a, b) => a + Math.round(Number(b.net_price) * 100), 0);
      expect(sum, `order ${t.order_number}`).toBe(Math.round(Number(t.amount_paid) * 100));
      expect(new Set(group.map((b) => b.transaction_id))).toEqual(new Set([t.id]));
    }
    // Every paid row with money has its commission; earning + commission = customer_paid.
    for (const c of rows.get('commissions') ?? [])
      expect(
        Math.round(Number(c.admin_commission) * 100) + Math.round(Number(c.organiser_earning) * 100),
      ).toBe(Math.round(Number(c.customer_paid) * 100));
  });

  it('plants the edge cases the migration must handle', () => {
    const yay = dumps.yay?.summary;
    const abc = dumps.abc?.summary;
    expect(yay?.facts.dstEvents.map((d) => d.kind)).toEqual(['fold', 'gap']);
    expect(abc?.facts.dstEvents.map((d) => d.kind)).toEqual(['fold']);
    expect(yay?.facts.duplicateOrderNumbers.length).toBeGreaterThan(0);
    expect(abc?.facts.hijackEmails.length).toBeGreaterThan(0);
    const rows = rowsOf(dumps.yay?.text ?? '');
    const bookings = rows.get('bookings') ?? [];
    expect(bookings.some((b) => b.is_distributable === '1' && Number(b.quantity) > 1)).toBe(true);
    expect(bookings.some((b) => b.distributed_from_booking_id)).toBe(true);
    expect(bookings.some((b) => b.booking_cancel === '3')).toBe(true);
    expect(bookings.some((b) => b.is_paid === '0')).toBe(true);
    const gateways = new Set((rows.get('transactions') ?? []).map((t) => t.payment_gateway));
    expect(gateways).toEqual(new Set(['Stripe', 'Stripe Direct', 'PayPal']));
    expect((rows.get('attendees') ?? []).some((a) => a.address === 'N/A')).toBe(true);
    // Users sharing an email across instances (with case and whitespace variations on abc).
    const yayEmails = new Set((rows.get('users') ?? []).map((u) => emailNorm(u.email as string)));
    const abcUsers = rowsOf(dumps.abc?.text ?? '').get('users') ?? [];
    const shared = abcUsers.filter((u) => yayEmails.has(emailNorm(u.email as string)));
    expect(shared.length).toBeGreaterThan(2);
    expect(shared.some((u) => u.email !== emailNorm(u.email as string))).toBe(true);
  });
});
