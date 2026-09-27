import { effectiveModules, getEntitlementsQuery, setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { composeNav } from '@yayatoh/platform';
import {
  addMemberCommand,
  changeMemberRoleCommand,
  createOrganization,
  getOrganizationQuery,
  listMembersQuery,
  myOrganizations,
  removeMemberCommand,
  resolveOrgSlug,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('tenancy: organizations', () => {
  it('creating an org makes the creator its owner, emits an event and writes an audit row', async () => {
    const [evt] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ type: string }>(
        sql`select type from platform.domain_events where type = 'organization.created'`,
      ),
    );
    expect(evt?.type).toBe('organization.created');
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string; actor: string }>(
        sql`select action, actor from platform.audit_events where action = 'organization.create'`,
      ),
    );
    expect(audit).toEqual({ action: 'organization.create', actor: `user:${a.ownerId}` });
    expect(await myOrganizations(a.ownerId)).toEqual([
      { orgId: a.org.id, slug: a.org.slug, name: 'Alpha Events', role: 'owner' },
    ]);
  });

  it('returns only allowlisted fields', async () => {
    const org = await executeQuery(getOrganizationQuery, {}, a.ctx(), ports);
    expect(Object.keys(org).sort()).toEqual(
      [
        'country',
        'currency',
        'defaultLocale',
        'defaultProfile',
        'id',
        'kind',
        'name',
        'slug',
        'status',
        'timezone',
      ].sort(),
    );
    expect(org.timezone).toBe('America/Chicago');
  });

  it('rejects a taken slug with a conflict', async () => {
    await expect(
      createOrganization(userCtx(uuidv7()), { slug: a.org.slug, name: 'Copycat' }, ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'slug' } });
  });

  it('resolves slugs to ids without exposing anything else', async () => {
    expect(await resolveOrgSlug(b.org.slug)).toEqual({ orgId: b.org.id, status: 'active' });
    expect(await resolveOrgSlug('does-not-exist')).toBeNull();
  });

  it('a user cannot act in an org they do not belong to', async () => {
    const intruder = userCtx(a.ownerId, b.org.id);
    await expect(executeQuery(getOrganizationQuery, {}, intruder, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(updateOrganizationCommand, { name: 'pwned' }, intruder, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('a viewer can read but not manage', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(listMembersQuery, {}, viewer, ports)).length).toBe(2);
    await expect(
      executeCommand(addMemberCommand, { userId: uuidv7(), role: 'admin' }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps at least one owner', async () => {
    await expect(
      executeCommand(changeMemberRoleCommand, { userId: a.ownerId, role: 'admin' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      executeCommand(removeMemberCommand, { userId: a.ownerId }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });
});

describe('organization updates', () => {
  it('change only the fields they name (regression: defaults used to reset the rest)', async () => {
    const u = await executeCommand(updateOrganizationCommand, { name: 'Bravo Renamed' }, b.ctx(), ports);
    // The fixture created the org with profile "gala" and set America/Chicago.
    expect(u).toMatchObject({ name: 'Bravo Renamed', defaultProfile: 'gala', timezone: 'America/Chicago' });
  });
});

describe('idempotency', () => {
  it('replays the stored result for the same key and rejects the key for a different request', async () => {
    const ctx = a.ctx({ idempotencyKey: 'rename-1' });
    const cmd = { ...updateOrganizationCommand, idempotent: true };
    const first = await executeCommand(cmd, { name: 'Alpha Events Co' }, ctx, ports);
    const again = await executeCommand(cmd, { name: 'Alpha Events Co' }, ctx, ports);
    expect(again).toEqual(first);
    await expect(executeCommand(cmd, { name: 'Other' }, ctx, ports)).rejects.toMatchObject({
      code: 'idempotency_key_reused',
    });
    const [n] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events where action = 'organization.update' and request_id = ${ctx.requestId}`,
      ),
    );
    expect(n?.n).toBe(1);
  });
});

describe('entitlements', () => {
  it('every org starts on launch_standard', async () => {
    const mods = await effectiveModules(b.ctx());
    for (const m of ['core', 'ticketing', 'seating', 'checkin']) expect(mods.has(m)).toBe(true);
  });

  it('revoking a module hides its nav item and returns module_not_enabled — no deploy', async () => {
    const before = composeNav('gala', await effectiveModules(b.ctx())).map((i) => i.key);
    expect(before).toContain('seating');

    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'core', effect: 'revoke', reason: 'test: suspend core' },
      systemCtx(b.org.id),
      ports,
    );
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'seating', effect: 'revoke', reason: 'test: downgrade' },
      systemCtx(b.org.id),
      ports,
    );
    const after = composeNav('gala', await effectiveModules(b.ctx())).map((i) => i.key);
    expect(after).not.toContain('seating');
    await expect(executeQuery(listMembersQuery, {}, b.ctx(), ports)).rejects.toMatchObject({
      code: 'module_not_enabled',
      details: { module: 'core' },
    });

    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'core', effect: 'grant', reason: 'test: restore' },
      systemCtx(b.org.id),
      ports,
    );
    expect((await executeQuery(listMembersQuery, {}, b.ctx(), ports)).length).toBe(2);
    const ent = await executeQuery(getEntitlementsQuery, {}, b.ctx(), ports);
    expect(ent.modules).not.toContain('seating');
  });

  it('only a platform actor can change entitlements', async () => {
    await expect(
      executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'ai', effect: 'grant', reason: 'self-serve' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
