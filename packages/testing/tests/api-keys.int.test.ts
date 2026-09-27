import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  addMemberCommand,
  apiKeyIdentity,
  createApiKeyCommand,
  listApiKeysQuery,
  revokeApiKeyCommand,
} from '@yayatoh/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('org API keys (M1.13)', () => {
  it('shows the key once, stores only a hash, and resolves it to its own org and scopes', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Zapier', scopes: ['events:read', 'events:read', 'orders:read'] },
      a.ctx(),
      ports,
    );
    expect(k.key).toMatch(/^yy_live_[A-Za-z0-9_-]{43}$/);
    expect(k.prefix).toBe(k.key.slice(0, 12));
    expect(k.scopes).toEqual(['events:read', 'orders:read']);
    const listed = await executeQuery(listApiKeysQuery, {}, a.ctx(), ports);
    const row = listed.find((x) => x.id === k.id);
    expect(row).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(k.key);
    expect(await apiKeyIdentity(k.key)).toEqual({
      orgId: a.org.id,
      keyId: k.id,
      scopes: ['events:read', 'orders:read'],
    });
  });

  it('never gives a key more than its creator holds, and viewers cannot manage keys', async () => {
    const managerId = uuidv7();
    await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
    // Managers lack api_keys:manage altogether.
    await expect(
      executeCommand(
        createApiKeyCommand,
        { name: 'M', scopes: ['events:read'] },
        userCtx(managerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        createApiKeyCommand,
        { name: 'V', scopes: ['events:read'] },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(listApiKeysQuery, {}, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('validates the name and the scopes', async () => {
    for (const input of [
      { name: '', scopes: ['events:read'] },
      { name: 'x'.repeat(61), scopes: ['events:read'] },
      { name: 'No scopes', scopes: [] },
      { name: 'Bad scope', scopes: ['members:manage'] },
    ]) {
      await expect(executeCommand(createApiKeyCommand, input, a.ctx(), ports)).rejects.toMatchObject({
        code: 'validation_failed',
      });
    }
  });

  it('revokes: the key stops resolving at once; revoking twice is harmless', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Temp', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    const r = await executeCommand(revokeApiKeyCommand, { apiKeyId: k.id }, a.ctx(), ports);
    expect(r.revokedAt).toBeInstanceOf(Date);
    expect(await apiKeyIdentity(k.key)).toBeNull();
    const again = await executeCommand(revokeApiKeyCommand, { apiKeyId: k.id }, a.ctx(), ports);
    expect(again.revokedAt?.getTime()).toBe(r.revokedAt?.getTime());
  });

  it('is isolated per org: another org can neither list nor revoke the key', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Alpha only', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    const bKeys = await executeQuery(listApiKeysQuery, {}, b.ctx(), ports);
    expect(bKeys.map((x) => x.id)).not.toContain(k.id);
    await expect(
      executeCommand(revokeApiKeyCommand, { apiKeyId: k.id }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await apiKeyIdentity(k.key)).not.toBeNull();
  });

  it('rejects malformed keys without touching the database', async () => {
    expect(await apiKeyIdentity('yy_live_short')).toBeNull();
    expect(await apiKeyIdentity(`yy_live_${'A'.repeat(43)}`)).toBeNull();
  });
});
