import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  addDomainCommand,
  type DomainCheck,
  listDomainsQuery,
  MAX_CUSTOM_DOMAINS,
  managedHostname,
  recordDomainCheckCommand,
  recordDomainWalletsCommand,
  removeDomainCommand,
  resolveHost,
  setPrimaryDomainCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const tag = uuidv7().slice(-8);
const host = (name: string) => `${name}-${tag}.example.test`;

const add = (o: OrgFixture, hostname: string, ctx = o.ctx()) =>
  executeCommand(addDomainCommand, { hostname }, ctx, ports);
const check = (o: OrgFixture, domainId: string, status: DomainCheck['status']) =>
  executeCommand(
    recordDomainCheckCommand,
    {
      domainId,
      providerRef: 'fakedom_x',
      check: {
        status,
        records: [{ type: 'CNAME', name: 'x', value: 'cname.fake-dns.test' }],
        sslStatus: status === 'active' ? 'issued' : null,
        reason: status === 'failed' ? 'dns_conflict' : null,
      },
    },
    o.ctx(),
    ports,
  );
const list = (o: OrgFixture) => executeQuery(listDomainsQuery, {}, o.ctx(), ports);
const primaryOf = async (o: OrgFixture) => (await list(o)).find((d) => d.isPrimary)?.hostname;
const events = async (o: OrgFixture, type: string) => {
  const [r] = await withTenant(systemCtx(o.org.id), (tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from platform.domain_events where type = ${type}`,
    ),
  );
  return r?.n ?? 0;
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('domains (M1.3d)', () => {
  it('every org gets its managed subdomain, active and primary, resolving to the org', async () => {
    const [managed] = await list(a);
    expect(managed).toMatchObject({
      hostname: managedHostname(a.org.slug),
      managed: true,
      status: 'active',
      isPrimary: true,
      walletsReady: false,
    });
    expect(await resolveHost(managedHostname(a.org.slug).toUpperCase())).toEqual({
      orgId: a.org.id,
      primaryHost: managedHostname(a.org.slug),
    });
  });

  it('adds a custom domain waiting for DNS; typed forms are normalized', async () => {
    const d = await add(a, `https://${host('tickets').toUpperCase()}/`);
    expect(d).toMatchObject({
      hostname: host('tickets'),
      status: 'pending_dns',
      isPrimary: false,
      managed: false,
    });
    expect(await resolveHost(host('tickets'))).toBeNull();
    expect(await events(a, 'domain.added')).toBe(1);
  });

  it('refuses bad, reserved and taken hostnames, and viewers', async () => {
    await expect(add(a, 'not a domain')).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(add(a, 'abc.yayatoh.com')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(add(a, `x.${managedHostname(b.org.slug)}`)).rejects.toMatchObject({ code: 'forbidden' });
    // Taken by this org or by another one: the same answer.
    await expect(add(a, host('tickets'))).rejects.toMatchObject({ code: 'conflict' });
    await expect(add(b, host('tickets'))).rejects.toMatchObject({ code: 'conflict' });
    await expect(add(a, host('viewer'), userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('staff (system actor) may add a platform host such as abc.yayatoh.com', async () => {
    const d = await add(b, `abc-${tag}.yayatoh.com`, systemCtx(b.org.id));
    expect(d.hostname).toBe(`abc-${tag}.yayatoh.com`);
  });

  it('goes from pending to active: takes over as primary, once, and resolves', async () => {
    const d = (await list(a)).find((x) => x.hostname === host('tickets'));
    if (!d) throw new Error('missing');
    expect((await check(a, d.id, 'pending_dns')).status).toBe('pending_dns');
    expect(await primaryOf(a)).toBe(managedHostname(a.org.slug));
    const live = await check(a, d.id, 'active');
    expect(live).toMatchObject({ status: 'active', isPrimary: true, sslStatus: 'issued' });
    await check(a, d.id, 'active');
    expect(await events(a, 'domain.activated')).toBe(1);
    expect(await primaryOf(a)).toBe(host('tickets'));
    // The managed subdomain still resolves, pointing at the new primary.
    expect(await resolveHost(managedHostname(a.org.slug))).toEqual({
      orgId: a.org.id,
      primaryHost: host('tickets'),
    });
    expect(await resolveHost(host('tickets'))).toEqual({ orgId: a.org.id, primaryHost: host('tickets') });
  });

  it('a second live domain does not steal primary; the organizer can switch it', async () => {
    const d = await add(a, host('second'));
    await expect(
      executeCommand(setPrimaryDomainCommand, { domainId: d.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await check(a, d.id, 'active')).isPrimary).toBe(false);
    await executeCommand(setPrimaryDomainCommand, { domainId: d.id }, a.ctx(), ports);
    expect(await primaryOf(a)).toBe(host('second'));
  });

  it('a primary that stops resolving hands primary back to the managed subdomain', async () => {
    const d = (await list(a)).find((x) => x.hostname === host('second'));
    if (!d) throw new Error('missing');
    expect(await check(a, d.id, 'failed')).toMatchObject({
      status: 'failed',
      isPrimary: false,
      failureReason: 'dns_conflict',
    });
    expect(await primaryOf(a)).toBe(managedHostname(a.org.slug));
    expect(await resolveHost(host('second'))).toBeNull();
  });

  it('records wallets (Payment Method Domains) only for active hosts', async () => {
    const [managed, tickets, second] = await list(a);
    if (!managed || !tickets || !second) throw new Error('missing');
    await expect(
      executeCommand(
        recordDomainWalletsCommand,
        { domainId: second.id, paymentMethodDomainId: 'fakepmd_1' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const r = await executeCommand(
      recordDomainWalletsCommand,
      { domainId: managed.id, paymentMethodDomainId: 'fakepmd_2' },
      a.ctx(),
      ports,
    );
    expect(r.walletsReady).toBe(true);
  });

  it('removing frees the hostname; the managed subdomain cannot be removed', async () => {
    const [managed, tickets] = await list(a);
    if (!managed || !tickets) throw new Error('missing');
    await expect(
      executeCommand(removeDomainCommand, { domainId: managed.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    // Make it primary again, then remove it: primary goes back to the managed subdomain.
    await executeCommand(setPrimaryDomainCommand, { domainId: tickets.id }, a.ctx(), ports);
    await executeCommand(removeDomainCommand, { domainId: tickets.id }, a.ctx(), ports);
    expect(await primaryOf(a)).toBe(managedHostname(a.org.slug));
    expect((await add(b, host('tickets'))).hostname).toBe(host('tickets'));
  });

  it('org B cannot see or change org A’s domains', async () => {
    const [aManaged] = await list(a);
    if (!aManaged) throw new Error('missing');
    expect((await list(b)).some((d) => d.hostname.includes(a.org.slug))).toBe(false);
    await expect(
      executeCommand(setPrimaryDomainCommand, { domainId: aManaged.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it(`caps custom domains at ${MAX_CUSTOM_DOMAINS}`, async () => {
    const existing = (await list(b)).filter((d) => !d.managed).length;
    for (let i = existing; i < MAX_CUSTOM_DOMAINS; i++) await add(b, host(`cap${i}`));
    await expect(add(b, host('one-too-many'))).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'domain_limit' },
    });
  });
});
