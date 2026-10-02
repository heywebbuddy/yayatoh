import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { auditEntriesTx } from '@yayatoh/platform';
import {
  apiKeyIdentity,
  apiUsageQuery,
  createApiKeyCommand,
  createSandboxCommand,
  createSandboxOrg,
  deleteSandboxOrg,
  getOrganizationQuery,
  isSandboxOrg,
  listApiKeysQuery,
  listSandboxesQuery,
  MAX_SANDBOX_ORGS,
  memberRole,
  provisionSandboxOrgCommand,
  recordApiKeyUsage,
  resolveOrgSlug,
  rotateApiKeyCommand,
  summarizeApiKeyUsageCommand,
  unsummarizedApiKeyUsage,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, staleCtx, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const DAY = 86_400_000;
const near = (d: Date | null, at: number) => {
  expect(d).not.toBeNull();
  expect(Math.abs((d as Date).getTime() - at)).toBeLessThan(60_000);
};

describe('API key lifetimes (M6.3a)', () => {
  it('sets an expiry from the chosen lifetime and refuses other lifetimes', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: '30 days', scopes: ['events:read'], expiresInDays: 30 },
      a.ctx(),
      ports,
    );
    near(k.expiresAt, Date.now() + 30 * DAY);
    expect((await apiKeyIdentity(k.key))?.expiresAt?.getTime()).toBe(k.expiresAt?.getTime());
    const never = await executeCommand(
      createApiKeyCommand,
      { name: 'Forever', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    expect(never.expiresAt).toBeNull();
    for (const expiresInDays of [0, 7, 400, -1])
      await expect(
        executeCommand(
          createApiKeyCommand,
          { name: 'Odd', scopes: ['org:read'], expiresInDays },
          a.ctx(),
          ports,
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('an expired key resolves to nothing and loses its scopes', async () => {
    const past = new Date(Date.now() - 40 * DAY);
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Old', scopes: ['events:read'], expiresInDays: 30 },
      a.ctx({ now: past }),
      ports,
    );
    expect(await apiKeyIdentity(k.key)).toBeNull();
    // Listed (expired, not revoked), so the owner sees why it stopped.
    const row = (await executeQuery(listApiKeysQuery, {}, a.ctx(), ports)).find((x) => x.id === k.id);
    expect(row?.revokedAt).toBeNull();
    expect(row?.expiresAt?.getTime()).toBeLessThan(Date.now());
  });
});

describe('API key rotation (M6.3a)', () => {
  it('mints a new secret with the same name, scopes and lifetime; the old one works for the overlap', async () => {
    const old = await executeCommand(
      createApiKeyCommand,
      { name: 'Rotating', scopes: ['events:read', 'orders:read'], expiresInDays: 90 },
      a.ctx(),
      ports,
    );
    const r = await executeCommand(
      rotateApiKeyCommand,
      { apiKeyId: old.id, overlapHours: 24 },
      a.ctx(),
      ports,
    );
    expect(r.key).not.toBe(old.key);
    expect(r.key).toMatch(/^yy_live_/);
    expect(r.name).toBe('Rotating');
    expect(r.scopes).toEqual(['events:read', 'orders:read']);
    near(r.expiresAt, Date.now() + 90 * DAY);
    near(r.previousExpiresAt, Date.now() + DAY);
    // Both work during the overlap; the old one says it was replaced.
    expect((await apiKeyIdentity(old.key))?.keyId).toBe(old.id);
    expect((await apiKeyIdentity(r.key))?.keyId).toBe(r.id);
    const listed = await executeQuery(listApiKeysQuery, {}, a.ctx(), ports);
    expect(listed.find((x) => x.id === old.id)?.replacedById).toBe(r.id);
    // A key is rotated once; rotate the new one instead.
    await expect(
      executeCommand(rotateApiKeyCommand, { apiKeyId: old.id, overlapHours: 1 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'api_key_not_live' } });
    // The audit log has the rotation.
    const audit = await withTenant(a.ctx(), (tx) =>
      auditEntriesTx(tx, { action: 'apiKey.rotate' }, { limit: 5 }),
    );
    expect(audit.entries.some((e) => e.targetId === old.id)).toBe(true);
  });

  it('with no overlap the old key stops at once; a test key stays a test key', async () => {
    const old = await executeCommand(
      createApiKeyCommand,
      { name: 'Test rotate', scopes: ['org:read'], mode: 'test' },
      a.ctx(),
      ports,
    );
    const r = await executeCommand(
      rotateApiKeyCommand,
      { apiKeyId: old.id, overlapHours: 0 },
      a.ctx(),
      ports,
    );
    expect(r.key).toMatch(/^yy_test_/);
    expect(r.sandbox).toBe(true);
    expect(r.expiresAt).toBeNull();
    expect(await apiKeyIdentity(old.key)).toBeNull();
    expect((await apiKeyIdentity(r.key))?.sandbox).toBe(true);
  });

  it('needs step-up and api_keys:manage, refuses revoked keys and other orgs’ keys, and validates the overlap', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Guarded', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(rotateApiKeyCommand, { apiKeyId: k.id }, staleCtx(a.ctx()), ports),
    ).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(
      executeCommand(rotateApiKeyCommand, { apiKeyId: k.id }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(rotateApiKeyCommand, { apiKeyId: k.id }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(rotateApiKeyCommand, { apiKeyId: k.id, overlapHours: 5 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await apiKeyIdentity(k.key)).not.toBeNull();
  });
});

describe('API key usage (M6.3a)', () => {
  it('counts requests, errors and 429s per key and day, and only the org sees them', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Counted', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    for (const status of [200, 201, 404, 429])
      await recordApiKeyUsage({ orgId: a.org.id, keyId: k.id, status });
    const u = await executeQuery(apiUsageQuery, { days: 7 }, a.ctx(), ports);
    expect(u.days).toHaveLength(7);
    expect(u.days.at(-1)?.day).toBe(u.to);
    const mine = u.keys.find((x) => x.apiKeyId === k.id);
    expect(mine).toMatchObject({ name: 'Counted', requests: 4, errors: 2, rateLimited: 1 });
    expect(u.totals.requests).toBeGreaterThanOrEqual(4);
    expect(u.days.at(-1)?.requests).toBeGreaterThanOrEqual(4);
    // Org b sees none of org a's keys; the viewer can't read usage.
    const other = await executeQuery(apiUsageQuery, { days: 7 }, b.ctx(), ports);
    expect(other.keys.some((x) => x.apiKeyId === k.id)).toBe(false);
    await expect(
      executeQuery(apiUsageQuery, { days: 7 }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('writes one audit summary per key and finished day, once', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Summarized', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`insert into tenancy.api_key_usage_daily (org_id, api_key_id, day, requests, errors, rate_limited)
        values (${a.org.id}, ${k.id}, (now() at time zone 'America/Chicago')::date - 2, 12, 3, 1)`),
    );
    await recordApiKeyUsage({ orgId: a.org.id, keyId: k.id, status: 200 });
    const due = (await unsummarizedApiKeyUsage(a.org.id)).filter((r) => r.apiKeyId === k.id);
    expect(due).toHaveLength(1);
    const [first] = due;
    if (!first) throw new Error('no due row');
    const sys = createCtx({ orgId: a.org.id, actor: { type: 'system', name: 'test' } });
    const r = await executeCommand(summarizeApiKeyUsageCommand, first, sys, ports);
    expect(r).toMatchObject({ requests: 12, errors: 3, rateLimited: 1 });
    await expect(executeCommand(summarizeApiKeyUsageCommand, first, sys, ports)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'already_summarized' },
    });
    expect((await unsummarizedApiKeyUsage(a.org.id)).some((x) => x.apiKeyId === k.id)).toBe(false);
    const audit = await withTenant(a.ctx(), (tx) =>
      auditEntriesTx(tx, { action: 'apiKey.dailyUsage' }, { limit: 20 }),
    );
    const entry = audit.entries.find((e) => e.targetId === k.id);
    expect(entry?.details).toMatchObject({ day: first.day, count: 12, errors: 3, rateLimited: 1 });
    // Today is not finished; a member can't summarize.
    const today = await executeQuery(apiUsageQuery, { days: 1 }, a.ctx(), ports);
    await expect(
      executeCommand(summarizeApiKeyUsageCommand, { apiKeyId: k.id, day: today.to }, sys, ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'day_not_finished' } });
    await expect(executeCommand(summarizeApiKeyUsageCommand, first, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('sandbox orgs (M6.3a)', () => {
  it('creates a sandbox linked to the org: the creator owns it, it copies the org’s settings', async () => {
    const s = await createSandboxOrg(a.ctx(), { name: 'Integration tests' }, ports);
    expect(s.slug).toMatch(new RegExp(`^${a.org.slug.slice(0, 40)}-sandbox-[0-9a-f]{6}$`));
    expect((await executeQuery(listSandboxesQuery, {}, a.ctx(), ports)).map((x) => x.id)).toContain(s.id);
    expect(await isSandboxOrg(s.sandboxOrgId)).toBe(true);
    expect(await isSandboxOrg(a.org.id)).toBe(false);
    expect(await resolveOrgSlug(s.slug)).toEqual({ orgId: s.sandboxOrgId, status: 'active' });
    const sandboxCtx = userCtx(a.ownerId, s.sandboxOrgId);
    expect(await memberRole(sandboxCtx)).toBe('owner');
    const org = await executeQuery(getOrganizationQuery, {}, sandboxCtx, ports);
    expect(org).toMatchObject({ name: 'Integration tests', sandbox: true, timezone: 'America/Chicago' });
    // The parent's other members are not members of the sandbox.
    expect(await memberRole(userCtx(a.viewerId, s.sandboxOrgId))).toBeNull();
    // A sandbox can't have sandboxes.
    await expect(createSandboxOrg(sandboxCtx, { name: 'Nested' }, ports)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'sandbox_of_sandbox' },
    });
    // Never on the marketplace.
    await expect(
      executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, sandboxCtx, ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'sandbox_org' } });
  });

  it('only owners and admins create sandboxes; names are validated; at most the limit', async () => {
    await expect(
      createSandboxOrg(userCtx(a.viewerId, a.org.id), { name: 'Viewer' }, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const name of ['', 'x'.repeat(61)])
      await expect(createSandboxOrg(a.ctx(), { name }, ports)).rejects.toMatchObject({
        code: 'validation_failed',
      });
    const live = (await executeQuery(listSandboxesQuery, {}, b.ctx(), ports)).length;
    // Links alone fill the quota (no need to provision ten orgs).
    for (let i = live; i < MAX_SANDBOX_ORGS; i++)
      await executeCommand(createSandboxCommand, { name: `Sandbox ${i}` }, b.ctx(), ports);
    await expect(createSandboxOrg(b.ctx(), { name: 'One too many' }, ports)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'sandbox_limit' },
    });
  });

  it('provisioning needs the parent’s link, and only the platform provisions', async () => {
    const orphan = uuidv7();
    const input = {
      parentOrgId: a.org.id,
      name: 'Orphan',
      slug: `orphan-${orphan.slice(-8)}`,
      ownerUserId: a.ownerId,
      timezone: 'UTC',
      country: 'US',
      currency: 'USD',
      defaultLocale: 'en',
      defaultProfile: 'other',
    };
    await expect(
      executeCommand(
        provisionSandboxOrgCommand,
        input,
        createCtx({ orgId: orphan, actor: { type: 'system', name: 't' } }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'sandbox_link_missing' } });
    await expect(
      executeCommand(provisionSandboxOrgCommand, input, userCtx(a.ownerId, orphan), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Another org's link doesn't let anyone provision under a different parent.
    const link = await executeCommand(createSandboxCommand, { name: 'Half made' }, a.ctx(), ports);
    await expect(
      executeCommand(
        provisionSandboxOrgCommand,
        { ...input, parentOrgId: b.org.id, slug: link.slug },
        createCtx({ orgId: link.sandboxOrgId, actor: { type: 'system', name: 't' } }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('deleting a sandbox closes it, removes its members and revokes its keys (step-up)', async () => {
    const s = await createSandboxOrg(a.ctx(), { name: 'To delete' }, ports);
    const sandboxCtx = userCtx(a.ownerId, s.sandboxOrgId);
    const key = await executeCommand(
      createApiKeyCommand,
      { name: 'Sandbox key', scopes: ['org:read'] },
      sandboxCtx,
      ports,
    );
    expect((await apiKeyIdentity(key.key))?.orgSandbox).toBe(true);
    await expect(deleteSandboxOrg(staleCtx(a.ctx()), { sandboxId: s.id }, ports)).rejects.toMatchObject({
      code: 'step_up_required',
    });
    await expect(
      deleteSandboxOrg(userCtx(a.viewerId, a.org.id), { sandboxId: s.id }, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Org b can't see or delete org a's sandbox.
    expect((await executeQuery(listSandboxesQuery, {}, b.ctx(), ports)).some((x) => x.id === s.id)).toBe(
      false,
    );
    await expect(deleteSandboxOrg(b.ctx(), { sandboxId: s.id }, ports)).rejects.toMatchObject({
      code: 'not_found',
    });

    await deleteSandboxOrg(a.ctx(), { sandboxId: s.id }, ports);
    expect((await executeQuery(listSandboxesQuery, {}, a.ctx(), ports)).some((x) => x.id === s.id)).toBe(
      false,
    );
    expect(await memberRole(sandboxCtx)).toBeNull();
    expect(await apiKeyIdentity(key.key)).toBeNull();
    expect((await resolveOrgSlug(s.slug))?.status).toBe('terminated');
    await expect(deleteSandboxOrg(a.ctx(), { sandboxId: s.id }, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const audit = await withTenant(a.ctx(), (tx) =>
      auditEntriesTx(tx, { action: 'sandbox.delete' }, { limit: 5 }),
    );
    expect(audit.entries.some((e) => e.targetId === s.sandboxOrgId)).toBe(true);
  });
});
