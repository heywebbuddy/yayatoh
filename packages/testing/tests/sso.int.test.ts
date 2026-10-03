import { randomBytes } from 'node:crypto';
import { createAuth, findOrCreateSsoAccount, memoryMailer, revokeAllSessions } from '@yayatoh/auth';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  addDomainCommand,
  applyUserPatch,
  checkDomainCommand,
  completeSsoLoginCommand,
  connectionView,
  createScimTokenCommand,
  deleteConnectionCommand,
  EXPIRED_IDP_CERTIFICATE,
  FAKE_IDP_CERTIFICATE,
  fakeIdpMetadata,
  openFakeIdpAnswer,
  parsePatch,
  publishFakeTxt,
  recordConnectionTestCommand,
  removeDomainCommand,
  revokeScimTokenCommand,
  saveConnectionCommand,
  scimCreateGroupCommand,
  scimCreateUserCommand,
  scimCtx,
  scimDeleteUserCommand,
  scimEmailAllowed,
  scimGetUserQuery,
  scimListUsersQuery,
  scimTokenIdentity,
  scimUpdateGroupCommand,
  scimUpdateUserCommand,
  scimUserFieldsQuery,
  setConnectionStatusCommand,
  setDomainEnforcementCommand,
  setGroupRoleCommand,
  signFakeIdpAnswer,
  ssoForEmail,
  ssoPrecheck,
  ssoRequiredFor,
  ssoSettingsQuery,
} from '@yayatoh/sso';
import { memberRole } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_IDP_SEED,
  type OrgFixture,
  ports,
  ssoFixtureDomain,
  staleCtx,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const BASE_URL = 'https://app.yayatoh.test/api/scim/v2';
const sp = {
  entityId: 'https://app.yayatoh.test/auth/sso/saml/metadata',
  acsUrl: 'https://app.yayatoh.test/auth/sso/saml/acs',
  redirectUri: 'https://app.yayatoh.test/auth/sso/callback',
};
const auth = createAuth({
  baseURL: 'http://localhost:3996',
  secret: randomBytes(32).toString('hex'),
  mailer: memoryMailer().mailer,
});

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (isDomainError(err))
      return { code: err.code, reason: err.details?.reason, scimType: err.details?.scimType };
    throw err;
  }
  throw new Error('expected a refusal');
};
const loginCtx = (orgId: string): Ctx => createCtx({ orgId, actor: { type: 'system', name: 'sso.login' } });
const settings = (o: OrgFixture) => executeQuery(ssoSettingsQuery, {}, o.ctx(), ports);
const roleOf = (o: OrgFixture, userId: string) => memberRole(userCtx(userId, o.org.id));
const unique = () => randomBytes(4).toString('hex');

describe('connection settings (M6.5a)', () => {
  it('lists the fixture connection, domain, token, group and SCIM user; never a secret', async () => {
    const s = await settings(a);
    expect(s.connection).toMatchObject({ protocol: 'saml', status: 'active', testPassed: true, oidc: null });
    expect(s.connection?.saml?.certificateSubject).toContain('Yayatoh Fake IdP');
    expect(s.domains).toMatchObject([
      { domain: ssoFixtureDomain(a.org.slug), status: 'verified', enforced: false },
    ]);
    expect(s.scimToken?.prefix).toMatch(/^yy_scim_/);
    expect(s.groups).toMatchObject([{ displayName: 'Fixture group', role: null, members: 1 }]);
    expect(s.scimUsers).toEqual({ active: 1, deprovisioned: 0 });
    expect(JSON.stringify(s)).not.toMatch(/token_hash|tokenHash|clientSecret"/);
  });

  it('owners and admins only, with step-up, and only with the enterprise module', async () => {
    expect(
      await code(executeQuery(ssoSettingsQuery, {}, userCtx(a.viewerId, a.org.id), ports)),
    ).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await code(
        executeCommand(setConnectionStatusCommand, { status: 'disabled' }, staleCtx(a.ctx()), ports),
      ),
    ).toMatchObject({ code: 'step_up_required' });
    const c = await twoOrgs();
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'enterprise', effect: 'revoke', reason: 'test' },
      systemCtx(c.a.org.id),
      ports,
    );
    expect(await code(executeQuery(ssoSettingsQuery, {}, c.a.ctx(), ports))).toMatchObject({
      code: 'module_not_enabled',
    });
  });

  it('reads SAML metadata (XML or URL), checks certificates, and seals the OIDC secret', async () => {
    const { a: o } = await twoOrgs();
    await executeCommand(deleteConnectionCommand, {}, o.ctx(), ports);
    const fromXml = await executeCommand(
      saveConnectionCommand,
      { protocol: 'saml', name: 'Okta', metadataXml: fakeIdpMetadata('https://idp.acme.test/idp') },
      o.ctx(),
      ports,
    );
    expect(fromXml.saml).toMatchObject({
      entityId: 'https://idp.acme.test/idp',
      ssoUrl: 'https://idp.acme.test/idp/sso/saml',
    });
    expect(fromXml.status).toBe('draft');
    const fromUrl = await executeCommand(
      saveConnectionCommand,
      { protocol: 'saml', name: 'Okta', metadataUrl: 'https://okta.example.test/app/metadata' },
      o.ctx(),
      ports,
    );
    expect(fromUrl.saml?.entityId).toBe('https://okta.example.test/idp');
    expect(
      await code(
        executeCommand(
          saveConnectionCommand,
          { protocol: 'saml', name: 'x', metadataUrl: 'https://okta.example.test/missing' },
          o.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed', reason: 'metadata_unreachable' });
    expect(
      await code(
        executeCommand(
          saveConnectionCommand,
          { protocol: 'saml', name: 'x', metadataXml: '<x/>' },
          o.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed', reason: 'invalid_metadata' });
    expect(
      await code(
        executeCommand(
          saveConnectionCommand,
          {
            protocol: 'saml',
            name: 'x',
            entityId: 'https://idp.acme.test',
            ssoUrl: 'https://idp.acme.test/sso',
            certificate: 'garbage',
          },
          o.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed', reason: 'certificate_invalid' });
    // An expired certificate is accepted as a setting, and the connection check refuses it.
    const expired = await executeCommand(
      saveConnectionCommand,
      {
        protocol: 'saml',
        name: 'x',
        entityId: 'https://idp.acme.test',
        ssoUrl: 'https://idp.acme.test/sso',
        certificate: EXPIRED_IDP_CERTIFICATE,
      },
      o.ctx(),
      ports,
    );
    expect(expired.saml?.certificateExpires?.toISOString()).toBe('2021-01-01T00:00:00.000Z');
    // Changing the protocol needs a delete first; OIDC needs a secret, which is sealed.
    expect(
      await code(
        executeCommand(
          saveConnectionCommand,
          {
            protocol: 'oidc',
            name: 'x',
            issuer: 'https://login.acme.test',
            clientId: 'c',
            clientSecret: 's',
          },
          o.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'protocol_change' });
    await executeCommand(deleteConnectionCommand, {}, o.ctx(), ports);
    expect(
      await code(
        executeCommand(
          saveConnectionCommand,
          { protocol: 'oidc', name: 'x', issuer: 'https://login.acme.test', clientId: 'c' },
          o.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed' });
    const oidc = await executeCommand(
      saveConnectionCommand,
      {
        protocol: 'oidc',
        name: 'Entra',
        issuer: 'https://login.acme.test',
        clientId: 'c',
        clientSecret: 'shh-secret',
      },
      o.ctx(),
      ports,
    );
    expect(oidc.oidc).toEqual({ issuer: 'https://login.acme.test', clientId: 'c', hasSecret: true });
    const [raw] = await withTenant(systemCtx(o.org.id), (tx) =>
      tx.execute<{ s: string }>(sql`select client_secret_sealed as s from sso.connections`),
    );
    expect(raw?.s).toBeTruthy();
    expect(raw?.s).not.toContain('shh-secret');
    expect((await connectionView(o.org.id, oidc.id))?.clientSecret).toBe('shh-secret');
  });

  it('activates only after a passed test with the current settings and a verified domain', async () => {
    const { a: o } = await twoOrgs();
    expect((await settings(o)).connection?.status).toBe('active');
    // A settings change puts the active connection back to draft (a new test is due).
    const conn = await executeCommand(
      saveConnectionCommand,
      { protocol: 'saml', name: 'Changed', metadataXml: fakeIdpMetadata('https://idp.other.test/idp') },
      o.ctx(),
      ports,
    );
    expect(conn).toMatchObject({ status: 'draft', testPassed: false });
    expect(
      await code(executeCommand(setConnectionStatusCommand, { status: 'active' }, o.ctx(), ports)),
    ).toMatchObject({
      code: 'invalid_state',
      reason: 'test_required',
    });
    await executeCommand(
      recordConnectionTestCommand,
      { connectionId: conn.id, ok: false, reason: 'wrong_audience' },
      o.ctx(),
      ports,
    );
    expect(
      await code(executeCommand(setConnectionStatusCommand, { status: 'active' }, o.ctx(), ports)),
    ).toMatchObject({
      reason: 'test_required',
    });
    await executeCommand(recordConnectionTestCommand, { connectionId: conn.id, ok: true }, o.ctx(), ports);
    expect(
      (await executeCommand(setConnectionStatusCommand, { status: 'active' }, o.ctx(), ports)).status,
    ).toBe('active');
    // Without a verified domain it can't be active.
    const { a: fresh } = await twoOrgs();
    const s = await settings(fresh);
    for (const d of s.domains)
      await executeCommand(removeDomainCommand, { domainId: d.id }, fresh.ctx(), ports);
    await executeCommand(setConnectionStatusCommand, { status: 'disabled' }, fresh.ctx(), ports);
    expect(
      await code(executeCommand(setConnectionStatusCommand, { status: 'active' }, fresh.ctx(), ports)),
    ).toMatchObject({
      reason: 'domain_required',
    });
  });
});

describe('domain verification', () => {
  it('needs the TXT record, then is verified for one org only', async () => {
    const domain = `acme-${unique()}.test`;
    const d = await executeCommand(
      addDomainCommand,
      { domain: `Jane@${domain.toUpperCase()}` },
      a.ctx(),
      ports,
    );
    expect(d).toMatchObject({ domain, status: 'pending', record: { name: `_yayatoh-sso.${domain}` } });
    expect(d.record.value).toMatch(/^yayatoh-verification=[A-Za-z0-9_-]{32}$/);
    expect(await code(executeCommand(addDomainCommand, { domain }, a.ctx(), ports))).toMatchObject({
      code: 'conflict',
      reason: 'already_added',
    });
    expect(
      await code(executeCommand(addDomainCommand, { domain: 'localhost' }, a.ctx(), ports)),
    ).toMatchObject({
      code: 'validation_failed',
    });
    const missing = await executeCommand(checkDomainCommand, { domainId: d.id }, a.ctx(), ports);
    expect(missing).toMatchObject({ status: 'failed', failureReason: 'record_not_found' });
    // B claims it too, with its own token; B's record doesn't verify A.
    const bd = await executeCommand(addDomainCommand, { domain }, b.ctx(), ports);
    publishFakeTxt(bd.record.name, bd.record.value);
    expect((await executeCommand(checkDomainCommand, { domainId: d.id }, a.ctx(), ports)).status).toBe(
      'failed',
    );
    expect((await executeCommand(checkDomainCommand, { domainId: bd.id }, b.ctx(), ports)).status).toBe(
      'verified',
    );
    // A publishes its own record now, but the domain is B's.
    publishFakeTxt(d.record.name, d.record.value);
    expect(await executeCommand(checkDomainCommand, { domainId: d.id }, a.ctx(), ports)).toMatchObject({
      status: 'failed',
      failureReason: 'claimed_elsewhere',
    });
    // B's verified domain resolves to B's connection for "Sign in with SSO".
    expect(await ssoForEmail(`someone@${domain}`)).toEqual({
      orgId: b.org.id,
      connectionId: (await settings(b)).connection?.id,
      orgSlug: b.org.slug,
    });
    expect(await ssoForEmail('someone@unknown-domain.test')).toBeNull();
  });

  it('enforcement needs a verified domain and an active connection; owners stay exempt', async () => {
    const { a: o } = await twoOrgs();
    const s = await settings(o);
    const verified = s.domains[0];
    if (!verified) throw new Error('fixture domain missing');
    const pending = await executeCommand(
      addDomainCommand,
      { domain: `pending-${unique()}.test` },
      o.ctx(),
      ports,
    );
    expect(
      await code(
        executeCommand(setDomainEnforcementCommand, { domainId: pending.id, enforced: true }, o.ctx(), ports),
      ),
    ).toMatchObject({ reason: 'domain_not_verified' });
    await executeCommand(
      setDomainEnforcementCommand,
      { domainId: verified.id, enforced: true },
      o.ctx(),
      ports,
    );
    const email = `viewer@${verified.domain}`;
    expect(await ssoRequiredFor({ orgId: o.org.id, userId: o.viewerId, email })).toBe(true);
    expect(
      await ssoRequiredFor({ orgId: o.org.id, userId: o.ownerId, email: `owner@${verified.domain}` }),
    ).toBe(false);
    expect(
      await ssoRequiredFor({ orgId: o.org.id, userId: o.viewerId, email: 'viewer@elsewhere.test' }),
    ).toBe(false);
    // Disabling the connection ends enforcement.
    await executeCommand(setConnectionStatusCommand, { status: 'disabled' }, o.ctx(), ports);
    expect(await ssoRequiredFor({ orgId: o.org.id, userId: o.viewerId, email })).toBe(false);
    expect((await settings(o)).domains.find((d) => d.id === verified.id)?.enforced).toBe(false);
    expect(
      await code(
        executeCommand(
          setDomainEnforcementCommand,
          { domainId: verified.id, enforced: true },
          o.ctx(),
          ports,
        ),
      ),
    ).toMatchObject({ reason: 'connection_inactive' });
  });
});

describe('sign-in and just-in-time provisioning', () => {
  it('a first sign-in from a verified domain links the identity and adds a member with the default role', async () => {
    const domain = ssoFixtureDomain(a.org.slug);
    const conn = (await settings(a)).connection;
    if (!conn) throw new Error('no connection');
    const email = `new-${unique()}@${domain}`;
    const pre = await ssoPrecheck({
      orgId: a.org.id,
      connectionId: conn.id,
      subject: `s-${email}`,
      email,
      test: false,
    });
    expect(pre).toEqual({ ok: true, linkedUserId: null });
    const account = await findOrCreateSsoAccount(auth, {
      email,
      name: 'New Person',
      via: 'sso',
      protocol: 'saml',
    });
    expect(account.created).toBe(true);
    const r = await executeCommand(
      completeSsoLoginCommand,
      { connectionId: conn.id, subject: `s-${email}`, email, userId: account.userId },
      loginCtx(a.org.id),
      ports,
    );
    expect(r).toEqual({ orgId: a.org.id, role: 'viewer', provisioned: true });
    expect(await roleOf(a, account.userId)).toBe('viewer');
    // The next sign-in finds the link and keeps the membership as it is.
    expect(
      await ssoPrecheck({
        orgId: a.org.id,
        connectionId: conn.id,
        subject: `s-${email}`,
        email,
        test: false,
      }),
    ).toEqual({ ok: true, linkedUserId: account.userId });
    expect(
      await executeCommand(
        completeSsoLoginCommand,
        { connectionId: conn.id, subject: `s-${email}`, email, userId: account.userId },
        loginCtx(a.org.id),
        ports,
      ),
    ).toEqual({ orgId: a.org.id, role: 'viewer', provisioned: false });
    // Another subject for the same account (or the same subject for another account) is refused.
    expect(
      await code(
        executeCommand(
          completeSsoLoginCommand,
          { connectionId: conn.id, subject: 'someone-else', email, userId: account.userId },
          loginCtx(a.org.id),
          ports,
        ),
      ),
    ).toMatchObject({ code: 'forbidden', reason: 'identity_conflict' });
  });

  it("an address outside the org's verified domains is refused before any account exists", async () => {
    const conn = (await settings(a)).connection;
    if (!conn) throw new Error('no connection');
    const email = `ceo@${ssoFixtureDomain(b.org.slug)}`;
    expect(
      await ssoPrecheck({ orgId: a.org.id, connectionId: conn.id, subject: 'x', email, test: false }),
    ).toEqual({
      ok: false,
      reason: 'domain_not_verified',
    });
    expect(
      await code(
        executeCommand(
          completeSsoLoginCommand,
          { connectionId: conn.id, subject: 'x', email, userId: uuidv7() },
          loginCtx(a.org.id),
          ports,
        ),
      ),
    ).toMatchObject({ reason: 'domain_not_verified' });
  });

  it('without just-in-time provisioning, only existing members or SCIM users sign in', async () => {
    const { a: o } = await twoOrgs();
    const conn = (await settings(o)).connection;
    if (!conn) throw new Error('no connection');
    await executeCommand(
      saveConnectionCommand,
      {
        protocol: 'saml',
        name: conn.name,
        jit: false,
        entityId: conn.saml?.entityId ?? '',
        ssoUrl: conn.saml?.ssoUrl ?? '',
        certificate: FAKE_IDP_CERTIFICATE,
      },
      o.ctx(),
      ports,
    );
    const email = `nojit-${unique()}@${ssoFixtureDomain(o.org.slug)}`;
    const { userId } = await findOrCreateSsoAccount(auth, { email, name: null, via: 'sso' });
    expect(
      await code(
        executeCommand(
          completeSsoLoginCommand,
          { connectionId: conn.id, subject: email, email, userId },
          loginCtx(o.org.id),
          ports,
        ),
      ),
    ).toMatchObject({ reason: 'not_provisioned' });
    expect(await roleOf(o, userId)).toBeNull();
  });

  it('an unverified account with the address loses its password before SSO signs into it (pre-hijack guard)', async () => {
    const email = `squatter-${unique()}@${ssoFixtureDomain(a.org.slug)}`;
    const res = await auth.api.signUpEmail({
      body: { email, password: 'attacker password 1', name: 'Squatter' },
    });
    const again = await findOrCreateSsoAccount(auth, { email, name: null, via: 'sso' });
    expect(again).toEqual({ userId: res.user.id, created: false });
    await expect(
      auth.api.signInEmail({ body: { email, password: 'attacker password 1' } }),
    ).rejects.toBeTruthy();
  });
});

describe('isolation: an assertion for org A never signs into org B', () => {
  it("A's IdP answer does not verify for B's connection, and A's connection can't be used in B", async () => {
    const connA = (await settings(a)).connection;
    const connB = (await settings(b)).connection;
    if (!connA || !connB) throw new Error('no connection');
    const viewA = await connectionView(a.org.id, connA.id);
    const viewB = await connectionView(b.org.id, connB.id);
    if (!viewA || !viewB) throw new Error('no view');
    const email = `x@${ssoFixtureDomain(a.org.slug)}`;
    const answer = signFakeIdpAnswer(FAKE_IDP_SEED, viewA, {
      protocol: 'saml',
      iss: viewA.config.protocol === 'saml' ? viewA.config.entityId : '',
      aud: sp.entityId,
      sub: 'sub-a',
      email,
      name: null,
      nonce: 'n',
    });
    expect(openFakeIdpAnswer(FAKE_IDP_SEED, viewA, { response: answer, nonce: 'n', sp }).ok).toBe(true);
    expect(openFakeIdpAnswer(FAKE_IDP_SEED, viewB, { response: answer, nonce: 'n', sp })).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
    // B can't see A's connection (RLS): a sign-in for B naming it is refused, nothing is created.
    expect(await connectionView(b.org.id, connA.id)).toBeNull();
    const { userId } = await findOrCreateSsoAccount(auth, { email, name: null, via: 'sso' });
    expect(
      await code(
        executeCommand(
          completeSsoLoginCommand,
          { connectionId: connA.id, subject: 'sub-a', email, userId },
          loginCtx(b.org.id),
          ports,
        ),
      ),
    ).toMatchObject({ reason: 'connection_inactive' });
    // With B's own connection, A's domain isn't B's: refused.
    expect(
      await code(
        executeCommand(
          completeSsoLoginCommand,
          { connectionId: connB.id, subject: 'sub-a', email, userId },
          loginCtx(b.org.id),
          ports,
        ),
      ),
    ).toMatchObject({ reason: 'domain_not_verified' });
    expect(await roleOf(b, userId)).toBeNull();
    // Each org sees only its own SSO rows.
    for (const o of [a, b]) {
      const rows = await withTenant(systemCtx(o.org.id), (tx) =>
        tx.execute<{ org_id: string }>(
          sql`select org_id from sso.identities union all select org_id from sso.connections union all select org_id from sso.scim_users`,
        ),
      );
      expect(new Set(rows.map((r) => r.org_id))).toEqual(new Set([o.org.id]));
    }
  });
});

describe('SCIM', () => {
  const scimFor = async (o: OrgFixture) => {
    const t = await executeCommand(createScimTokenCommand, {}, o.ctx(), ports);
    const id = await scimTokenIdentity(t.token);
    if (!id) throw new Error('token did not resolve');
    return { token: t.token, ctx: scimCtx(id.orgId, id.tokenId), orgId: id.orgId };
  };

  it('tokens resolve to their own org only, are shown once, rotate and revoke', async () => {
    const { a: o } = await twoOrgs();
    const first = await executeCommand(createScimTokenCommand, {}, o.ctx(), ports);
    expect(first.token).toMatch(/^yy_scim_[A-Za-z0-9_-]{43}$/);
    expect(first.rotated).toBe(true); // the fixture's token was live
    expect((await scimTokenIdentity(first.token))?.orgId).toBe(o.org.id);
    const second = await executeCommand(createScimTokenCommand, {}, o.ctx(), ports);
    expect(await scimTokenIdentity(first.token)).toBeNull();
    expect((await scimTokenIdentity(second.token))?.orgId).toBe(o.org.id);
    await executeCommand(revokeScimTokenCommand, {}, o.ctx(), ports);
    expect(await scimTokenIdentity(second.token)).toBeNull();
    expect(await scimTokenIdentity('yy_scim_nope')).toBeNull();
    expect((await settings(o)).scimToken).toBeNull();
    expect(
      await code(executeCommand(createScimTokenCommand, {}, userCtx(o.viewerId, o.org.id), ports)),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('provisions a member, maps groups to roles, and a deprovisioned user loses access on the next request', async () => {
    const { a: o } = await twoOrgs();
    const s = await scimFor(o);
    const email = `scim-${unique()}@${ssoFixtureDomain(o.org.slug)}`;
    expect(await scimEmailAllowed(s.ctx, email)).toBe(true);
    expect(await scimEmailAllowed(s.ctx, 'x@not-verified.test')).toBe(false);
    // A real account with a live session and a /v1 token pair.
    const account = await findOrCreateSsoAccount(auth, { email, name: 'Scim Person', via: 'scim' });
    const created = await executeCommand(
      scimCreateUserCommand,
      {
        userId: account.userId,
        baseUrl: BASE_URL,
        fields: {
          userName: email,
          email,
          externalId: '00u9',
          displayName: 'Scim Person',
          givenName: null,
          familyName: null,
          active: true,
        },
      },
      s.ctx,
      ports,
    );
    expect(created.revokeUserId).toBeNull();
    expect(created.resource).toMatchObject({ userName: email, active: true, emails: [{ value: email }] });
    expect(await roleOf(o, account.userId)).toBe('viewer');
    // Same userName again → uniqueness.
    expect(
      await code(
        executeCommand(
          scimCreateUserCommand,
          {
            userId: uuidv7(),
            baseUrl: BASE_URL,
            fields: {
              userName: email.toUpperCase(),
              email,
              externalId: null,
              displayName: null,
              givenName: null,
              familyName: null,
              active: true,
            },
          },
          s.ctx,
          ports,
        ),
      ),
    ).toMatchObject({ code: 'conflict', scimType: 'uniqueness' });
    // A group mapped to manager makes them a manager.
    const group = await executeCommand(
      scimCreateGroupCommand,
      {
        baseUrl: BASE_URL,
        fields: { displayName: `Managers ${unique()}`, externalId: null, members: [created.resource.id] },
      },
      s.ctx,
      ports,
    );
    expect(group.resource.members).toEqual([{ value: created.resource.id, display: email }]);
    expect(await roleOf(o, account.userId)).toBe('viewer');
    await executeCommand(
      setGroupRoleCommand,
      { groupId: group.resource.id, role: 'manager' },
      o.ctx(),
      ports,
    );
    expect(await roleOf(o, account.userId)).toBe('manager');
    // Filtered list.
    const list = await executeQuery(
      scimListUsersQuery,
      {
        filter: { attribute: 'userName', value: email.toUpperCase() },
        startIndex: 1,
        count: 10,
        baseUrl: BASE_URL,
      },
      s.ctx,
      ports,
    );
    expect(list.totalResults).toBe(1);
    expect(list.Resources[0]?.groups).toHaveLength(1);

    // Signed in: a session.
    const session = await (await auth.$context).internalAdapter.createSession(account.userId, false);
    expect(
      (await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${session.token}` }) }))
        ?.user.id,
    ).toBe(account.userId);

    // Deprovision (PATCH active false, as Entra sends it).
    const current = await executeQuery(scimUserFieldsQuery, { id: created.resource.id }, s.ctx, ports);
    if (!current) throw new Error('no user');
    const next = applyUserPatch(
      current,
      parsePatch({ Operations: [{ op: 'Replace', path: 'active', value: 'False' }] }),
    );
    const off = await executeCommand(
      scimUpdateUserCommand,
      { id: created.resource.id, fields: next, baseUrl: BASE_URL },
      s.ctx,
      ports,
    );
    expect(off.revokeUserId).toBe(account.userId);
    expect(off.resource.active).toBe(false);
    await revokeAllSessions(account.userId, 'scim_deprovisioned');
    // The next request: no session, no membership.
    expect(
      await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${session.token}` }) }),
    ).toBeNull();
    expect(await roleOf(o, account.userId)).toBeNull();
    // An SSO sign-in can't bring them back.
    const conn = (await settings(o)).connection;
    expect(
      await code(
        executeCommand(
          completeSsoLoginCommand,
          { connectionId: conn?.id ?? '', subject: 'sub-scim', email, userId: account.userId },
          loginCtx(o.org.id),
          ports,
        ),
      ),
    ).toMatchObject({ reason: 'deprovisioned' });
    expect((await settings(o)).scimUsers).toMatchObject({ deprovisioned: 1 });
    // Reactivating restores the membership (with the mapped role); deleting deprovisions again.
    const on = await executeCommand(
      scimUpdateUserCommand,
      { id: created.resource.id, fields: { ...next, active: true }, baseUrl: BASE_URL },
      s.ctx,
      ports,
    );
    expect(on.revokeUserId).toBeNull();
    expect(await roleOf(o, account.userId)).toBe('manager');
    const del = await executeCommand(scimDeleteUserCommand, { id: created.resource.id }, s.ctx, ports);
    expect(del.revokeUserId).toBe(account.userId);
    expect(await roleOf(o, account.userId)).toBeNull();
    expect(
      await executeQuery(scimGetUserQuery, { id: created.resource.id, baseUrl: BASE_URL }, s.ctx, ports),
    ).toBeNull();
  });

  it('never makes an owner, never changes one, and never removes the last owner', async () => {
    const { a: o } = await twoOrgs();
    const s = await scimFor(o);
    const ownerEmail = `owner@${ssoFixtureDomain(o.org.slug)}`;
    const owner = await executeCommand(
      scimCreateUserCommand,
      {
        userId: o.ownerId,
        baseUrl: BASE_URL,
        fields: {
          userName: ownerEmail,
          email: ownerEmail,
          externalId: null,
          displayName: null,
          givenName: null,
          familyName: null,
          active: true,
        },
      },
      s.ctx,
      ports,
    );
    expect(await roleOf(o, o.ownerId)).toBe('owner');
    const group = await executeCommand(
      scimCreateGroupCommand,
      {
        baseUrl: BASE_URL,
        fields: { displayName: 'Viewers', externalId: null, members: [owner.resource.id] },
      },
      s.ctx,
      ports,
    );
    await executeCommand(setGroupRoleCommand, { groupId: group.resource.id, role: 'viewer' }, o.ctx(), ports);
    expect(await roleOf(o, o.ownerId)).toBe('owner');
    const fields = await executeQuery(scimUserFieldsQuery, { id: owner.resource.id }, s.ctx, ports);
    if (!fields) throw new Error('no user');
    expect(
      await code(
        executeCommand(
          scimUpdateUserCommand,
          { id: owner.resource.id, fields: { ...fields, active: false }, baseUrl: BASE_URL },
          s.ctx,
          ports,
        ),
      ),
    ).toMatchObject({ code: 'invalid_state', reason: 'last_owner', scimType: 'mutability' });
    expect(await roleOf(o, o.ownerId)).toBe('owner');
    // Unknown members and another org's users are refused.
    expect(
      await code(
        executeCommand(
          scimUpdateGroupCommand,
          {
            id: group.resource.id,
            baseUrl: BASE_URL,
            fields: { displayName: 'Viewers', externalId: null, members: [uuidv7()] },
          },
          s.ctx,
          ports,
        ),
      ),
    ).toMatchObject({ code: 'validation_failed' });
  });

  it("a SCIM token for org A can't touch org B's users", async () => {
    const sa = await scimFor(a);
    const bUsers = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from sso.scim_users limit 1`),
    );
    const bUser = bUsers[0];
    if (!bUser) throw new Error('fixture SCIM user missing');
    expect(
      await executeQuery(scimGetUserQuery, { id: bUser.id, baseUrl: BASE_URL }, sa.ctx, ports),
    ).toBeNull();
    expect(await code(executeCommand(scimDeleteUserCommand, { id: bUser.id }, sa.ctx, ports))).toMatchObject({
      code: 'not_found',
    });
    // Member commands of the console still work for B (sanity: B's membership untouched).
    expect(await roleOf(b, b.viewerId)).toBe('viewer');
  });

  it('SSO-provisioned roles never exceed what the IdP is allowed to give (role allowlist)', async () => {
    const e = await code(
      executeCommand(setGroupRoleCommand, { groupId: uuidv7(), role: 'owner' as never }, a.ctx(), ports),
    );
    expect(e).toMatchObject({ code: 'validation_failed' });
  });
});
