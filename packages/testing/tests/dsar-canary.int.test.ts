import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { executeQuery, uuidv7 } from '@yayatoh/kernel';
import { catchUpErasedMedia } from '@yayatoh/media';
import { dataSubjectContributors } from '@yayatoh/platform';
import { dsarSigner, findSubjectQuery, resolveDataSubjectTx, verifyReceipt } from '@yayatoh/privacy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseNow, exportNow } from '../src/dsar/helpers.ts';
import { plantPerson } from '../src/dsar/plant/index.ts';
import { type ScanHit, scanOrg } from '../src/dsar/scan.ts';
import { type DsarPerson, dsarPerson } from '../src/dsar/types.ts';
import { type OrgFixture, twoOrgs } from '../src/index.ts';
import { ports } from '../src/ports.ts';

/**
 * M6.1c acceptance: "the canary person is gone from every table and projection except legally
 * held rows, which are listed in the receipt". The person is planted in every module of two orgs
 * (every table a contributor covers, plus the outbox log); org A erases them; afterwards no text,
 * JSON, array or byte column of any of org A's tables holds their address, last name or phone,
 * the legally held rows still exist (redacted) and are listed, and org B still has everything.
 */
const admin = adminClient();
let a: OrgFixture;
let b: OrgFixture;
let person: DsarPerson;
let plantedA: Set<string>;
let beforeA: ScanHit[];
let beforeB: ScanHit[];

const tokens = (p: DsarPerson) => [p.email, p.lastName, p.phone.slice(1)];
const tablesOf = (hits: readonly ScanHit[]) => [...new Set(hits.map((h) => h.table))].sort();

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  person = dsarPerson(uuidv7().slice(-10));
  for (const o of [a, b]) {
    const { tables } = await plantPerson({
      admin,
      orgId: o.org.id,
      ownerId: o.ownerId,
      eventId: o.event.id,
      person,
    });
    if (o === a) plantedA = tables;
  }
  beforeA = await scanOrg(admin, a.org.id, tokens(person));
  beforeB = await scanOrg(admin, b.org.id, tokens(person));
}, 180_000);
afterAll(closePools);

describe('DSAR propagation: the canary person (M6.1c)', () => {
  it('is planted in every table a contributor erases or holds', () => {
    const declared = dataSubjectContributors().flatMap((c) =>
      Object.entries(c.tables)
        .filter(([, act]) => act.action !== 'none')
        .map(([t]) => t),
    );
    // Every planted table is one a contributor covers (or the outbox log the platform redacts).
    expect([...plantedA].filter((t) => !declared.includes(t))).toEqual([]);
    // The scan sees the person in the planted tables that hold text.
    expect(tablesOf(beforeA).length).toBeGreaterThanOrEqual(30);
    for (const t of [
      'crm.contacts',
      'orders.orders',
      'ticketing.tickets',
      'attendees.attendees',
      'platform.domain_events',
    ])
      expect(tablesOf(beforeA)).toContain(t);
    expect(tablesOf(beforeB)).toEqual(tablesOf(beforeA));
  });

  it('resolves only the person’s own records: every name found is theirs', async () => {
    const subject = await withTenant(a.ctx(), (tx) => resolveDataSubjectTx(tx, a.ctx(), person.email));
    const names = subject.refs.name ?? [];
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !n.includes(person.lastName) && n !== person.firstName)).toEqual([]);
    expect(subject.refs.phone ?? []).toEqual(expect.arrayContaining([person.phone]));
  });

  it('the archive holds the person’s data from every module, and nothing of org B', async () => {
    const { modules, file } = await exportNow(person.email, a.ctx());
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(15);
    const text = JSON.stringify(modules);
    expect(text).toContain(person.email);
    expect(text).toContain(person.lastName);
    expect(text).not.toContain(b.org.id);
    expect(file.bytes.length).toBeGreaterThan(0);
  });

  it('erasure leaves nothing that identifies them in org A, lists the legal holds, and leaves org B alone', async () => {
    const r = await eraseNow(person.email, a.ctx());
    await catchUpErasedMedia(a.org.id);
    const after = await scanOrg(admin, a.org.id, tokens(person));
    expect(after).toEqual([]);

    // Legally held rows: still there (redacted, as the scan proved), each listed with its basis.
    const held = r.receipt.held;
    expect(held.map((h) => h.table)).toEqual(
      expect.arrayContaining(['orders.orders', 'orders.credit_notes', 'crm.consents']),
    );
    for (const h of held) {
      const [schema, table] = h.table.split('.') as [string, string];
      const [row] = await admin.unsafe<{ n: number }[]>(
        `select count(*)::int as n from "${schema}"."${table}" where org_id = $1 and id = $2`,
        [a.org.id, h.id],
      );
      expect(row?.n, `${h.table} ${h.id}`).toBe(1);
    }
    expect(held.find((h) => h.table === 'orders.orders')).toMatchObject({ basis: 'tax_accounting' });
    expect(verifyReceipt(r.receipt, r.signature, dsarSigner().publicKeyPem)).toBe(true);
    // Every module with planted rows reported what it did.
    expect(r.receipt.erased.length).toBeGreaterThanOrEqual(25);
    expect(r.receipt.files).toBeGreaterThanOrEqual(1);

    // Found nowhere now; org B still has all of it.
    expect((await executeQuery(findSubjectQuery, { email: person.email }, a.ctx(), ports)).found).toBe(false);
    expect(await scanOrg(admin, b.org.id, tokens(person))).toEqual(beforeB);
    expect((await executeQuery(findSubjectQuery, { email: person.email }, b.ctx(), ports)).found).toBe(true);
  }, 120_000);
});
