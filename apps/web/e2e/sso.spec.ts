import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { fakeIdpMetadata } from '@yayatoh/sso';
import {
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  ownClientIp,
  pickOption,
  signIn,
} from './helpers.ts';

/**
 * M6.5a single sign-on and SCIM, end to end on the fake IdP, fake DNS and the SCIM endpoint:
 * setup, domain verification, test sign-in, activation, SSO sign-in with just-in-time
 * provisioning (bound to the org), SCIM provisioning, group roles and deprovisioning.
 */

/** A domain unique per project and run (verified domains are unique platform-wide). */
const uniqueDomain = () =>
  `${test.info().project.name}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-') +
  '.e2e.test';

async function publishTxt(request: APIRequestContext, name: string, value: string) {
  const res = await request.post('/api/dev/sso/dns', { form: { name, value } });
  expect(res.status()).toBe(204);
}

/** A fresh owner (two-step verification on) of a new org, on the SSO settings page. */
async function ownerOnSettings(page: Page) {
  const owner = await newUser(page, { org: true, twoFactor: true });
  const slug = owner.orgSlug ?? '';
  await page.goto(`/o/${slug}/sso`);
  await expect(page.getByRole('heading', { name: 'Single sign-on', level: 1 })).toBeVisible();
  return { owner, slug };
}

/** Connect the fake IdP with pasted metadata, verify a domain, pass a test, turn on. */
async function setUp(page: Page, slug: string, domain: string) {
  await page.getByLabel('Name', { exact: true }).fill('Fake Okta');
  await page
    .getByRole('textbox', { name: 'Metadata XML' })
    .fill(fakeIdpMetadata(`https://idp.${domain}/idp`));
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
  await page.getByLabel('Domain', { exact: true }).fill(domain);
  await page.getByRole('button', { name: 'Add domain' }).click();
  const value = await page.getByLabel('Record value').inputValue();
  await publishTxt(page.request, `_yayatoh-sso.${domain}`, value);
  await page.getByRole('button', { name: `Check ${domain}` }).click();
  await expect(page.getByText(`Verified on`)).toBeVisible();
  await page.getByRole('button', { name: 'Test sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Fake identity provider' })).toBeVisible();
  await page.getByLabel('Email the provider vouches for').fill(`it@${domain}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/sso\\?test=passed`));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('On', { exact: true }).first()).toBeVisible();
}

/** Signs in with single sign-on in a new browser context; returns its page. */
async function ssoSignIn(browser: Browser, email: string) {
  const context = await browser.newContext();
  await ownClientIp(context);
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Sign in with single sign-on' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Fake identity provider' })).toBeVisible();
  await expect(page.getByLabel('Email the provider vouches for')).toHaveValue(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

const scim = (request: APIRequestContext, token: string) => ({
  post: (path: string, data: unknown) =>
    request.post(`/api/scim/v2/${path}`, { headers: { authorization: `Bearer ${token}` }, data }),
  patch: (path: string, data: unknown) =>
    request.patch(`/api/scim/v2/${path}`, { headers: { authorization: `Bearer ${token}` }, data }),
  get: (path: string) =>
    request.get(`/api/scim/v2/${path}`, { headers: { authorization: `Bearer ${token}` } }),
});

test.describe('single sign-on and SCIM (M6.5a)', () => {
  test('set up, verify a domain, test, turn on; SSO sign-in provisions into the org only', async ({
    page,
    browser,
  }) => {
    const { slug } = await ownerOnSettings(page);
    await expect(page.getByText('No identity provider yet')).toBeVisible();
    await expectAccessible(page);

    // Validation: a name is required; metadata must be SAML metadata.
    await page.getByRole('button', { name: 'Save connection' }).click();
    await expect(page.getByText('This is required.')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Broken');
    await page.getByRole('textbox', { name: 'Metadata XML' }).fill('<x/>');
    await page.getByRole('button', { name: 'Save connection' }).click();
    await expect(page.getByText("This isn't SAML identity provider metadata.")).toBeVisible();

    const domain = uniqueDomain();
    await page.getByLabel('Name', { exact: true }).fill('Fake Okta');
    await page
      .getByRole('textbox', { name: 'Metadata XML' })
      .fill(fakeIdpMetadata(`https://idp.${domain}/idp`));
    await page.getByRole('button', { name: 'Save connection' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
    await expect(page.getByText('Not on yet')).toBeVisible();
    // Can't turn on before a test and a verified domain.
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(
      page.getByText('Run a successful test sign-in with the current settings first.'),
    ).toBeVisible();

    // Domain verification through (fake) DNS.
    await page.getByLabel('Domain', { exact: true }).fill('not a domain');
    await page.getByRole('button', { name: 'Add domain' }).click();
    await expect(page.getByText('Enter a domain such as acme.com.')).toBeVisible();
    await page.getByLabel('Domain', { exact: true }).fill(domain);
    await page.getByRole('button', { name: 'Add domain' }).click();
    await expect(page.getByText('Waiting for DNS')).toBeVisible();
    await page.getByRole('button', { name: `Check ${domain}` }).click();
    await expect(page.getByText("We didn't find the TXT record yet.", { exact: false })).toBeVisible();
    await publishTxt(
      page.request,
      `_yayatoh-sso.${domain}`,
      await page.getByLabel('Record value').inputValue(),
    );
    await page.getByRole('button', { name: `Check ${domain}` }).click();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();

    // Test sign-in at the fake IdP (cancel, then pass).
    await page.getByRole('button', { name: 'Test sign-in' }).click();
    await expect(page.getByRole('heading', { name: 'Fake identity provider' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Test sign-in failed.')).toBeVisible();
    await expect(page.getByText('The test sign-in was cancelled.')).toBeVisible();
    await page.getByRole('button', { name: 'Test sign-in' }).click();
    await page.getByLabel('Email the provider vouches for').fill(`tester@${domain}`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Test sign-in passed.')).toBeVisible();
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Single sign-on is on.' })).toBeVisible();
    await expectAccessibleBothModes(page);

    // SSO sign-in: unknown addresses are told so; a domain address lands in the org (JIT).
    const ctx = await browser.newContext();
    await ownClientIp(ctx);
    const guest = await ctx.newPage();
    await guest.goto('/sign-in/sso');
    await guest.getByLabel('Work email').fill('nobody@unknown-domain.test');
    await guest.getByRole('button', { name: 'Continue' }).click();
    await expect(
      guest.getByText('No organization uses single sign-on for this address.', { exact: false }),
    ).toBeVisible();
    await expectAccessible(guest);
    await ctx.close();

    const jane = await ssoSignIn(browser, `jane-${Date.now()}@${domain}`);
    await expect(jane).toHaveURL(new RegExp(`/o/${slug}$`));
    // The session opens this org only: another org asks for a new sign-in.
    await jane.goto('/o/lakeside-events');
    await expect(jane).toHaveURL(/\/sign-in\?.*sso=other_org/);
    await expect(
      jane.getByText("You signed in with another organization's single sign-on.", { exact: false }),
    ).toBeVisible();
    await jane.context().close();
  });

  test('SCIM: token shown once, provision, map a group to a role, deprovision ends access at once', async ({
    page,
    browser,
  }) => {
    const { slug } = await ownerOnSettings(page);
    const domain = uniqueDomain();
    await setUp(page, slug, domain);

    expect((await page.request.get('/api/scim/v2/Users')).status()).toBe(401);
    await page.getByRole('button', { name: 'Create SCIM token' }).click();
    await expect(
      page.getByText("Copy this token now: it won't be shown again.", { exact: false }),
    ).toBeVisible();
    const token = await page.getByLabel('SCIM token').inputValue();
    expect(token).toMatch(/^yy_scim_/);
    await page.reload();
    await expect(page.getByLabel('SCIM token')).toHaveCount(0);
    const api = scim(page.request, token);

    // Outside the verified domains: refused.
    const outside = await api.post('Users', { userName: 'x@elsewhere.test', active: true });
    expect(outside.status()).toBe(400);

    const email = `sam-${Date.now()}@${domain}`;
    const created = await api.post('Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: email,
      name: { givenName: 'Sam', familyName: 'Scim' },
      emails: [{ value: email, primary: true }],
      active: true,
    });
    expect(created.status()).toBe(201);
    const user = (await created.json()) as { id: string; active: boolean };
    expect(user.active).toBe(true);
    const group = await api.post('Groups', {
      displayName: `Planners ${Date.now()}`,
      members: [{ value: user.id }],
    });
    expect(group.status()).toBe(201);
    const list = await api.get(`Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`);
    expect(((await list.json()) as { totalResults: number }).totalResults).toBe(1);

    // The group shows up; map it to Manager.
    await page.reload();
    const groupName = ((await group.json()) as { displayName: string }).displayName;
    await pickOption(page.getByLabel(`Role for ${groupName}`), { label: 'Manager' });
    await expect(page.getByRole('status').filter({ hasText: 'Role saved.' })).toBeVisible();
    await expect(page.getByText('1 person provisioned', { exact: false })).toBeVisible();

    // Sam signs in with SSO (already provisioned) and works in the org.
    const sam = await ssoSignIn(browser, email);
    await expect(sam).toHaveURL(new RegExp(`/o/${slug}$`));

    // Deprovisioned at the IdP: the very next request has no session.
    const off = await api.patch(`Users/${user.id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: 'False' }],
    });
    expect(off.status()).toBe(200);
    expect(((await off.json()) as { active: boolean }).active).toBe(false);
    await sam.goto(`/o/${slug}`);
    await expect(sam).toHaveURL(/\/sign-in/);
    // And signing in again with SSO is refused.
    await sam.goto('/sign-in/sso');
    await sam.getByLabel('Work email').fill(email);
    await sam.getByRole('button', { name: 'Continue' }).click();
    await sam.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      sam.getByText('Your access was removed by your organization.', { exact: false }),
    ).toBeVisible();
    await sam.context().close();

    // Revoke the token: provisioning stops.
    await page.getByRole('button', { name: 'Revoke token' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Token revoked.' })).toBeVisible();
    expect((await api.get('Users')).status()).toBe(401);
  });

  test('a viewer has no SSO settings: hidden in the nav and refused by URL', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events');
    await expect(page.getByRole('link', { name: 'Single sign-on' })).toHaveCount(0);
    await page.goto('/o/lakeside-events/sso');
    await expect(page.getByText('Only owners and admins manage single sign-on')).toBeVisible();
    await expectAccessible(page);
  });

  test('keyboard only: the SSO sign-in and the settings form', async ({ page }) => {
    await page.goto('/sign-in/sso');
    await page.getByLabel('Work email').focus();
    await page.keyboard.type('not-an-email');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();

    await ownerOnSettings(page);
    await page.getByRole('radio', { name: 'SAML 2.0' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'OpenID Connect' })).toBeChecked();
    await expect(page.getByLabel('Client secret')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type('Keyboard IdP');
    await page.getByLabel('Issuer URL').focus();
    await page.keyboard.type('https://login.keyboard.test');
    await page.keyboard.press('Tab');
    await page.keyboard.type('client-1');
    await page.keyboard.press('Tab');
    await page.keyboard.type('secret-1');
    await page.getByRole('button', { name: 'Save connection' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
    await expect(page.getByText('OpenID Connect').first()).toBeVisible();
  });

  test('Arabic renders right to left', async ({ page }) => {
    const { slug } = await ownerOnSettings(page);
    await page.goto('/ar/sign-in/sso');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}/sso`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
