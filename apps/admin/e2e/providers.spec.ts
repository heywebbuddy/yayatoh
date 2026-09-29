import { expect, test } from '@playwright/test';
import { expectAccessible, makeStaff, openTenant, signInStaff, WEB, webPage, webUser } from './helpers.ts';

/**
 * M3.5b in the staff console: provider health (last webhook, 24-hour counts, error rate) and each
 * provider's switch-on checklist, fed by real traffic through the dev fakes; and a tenant's
 * dedicated senders (a Twilio Messaging Service with its 10DLC status, the WhatsApp route), which
 * the organizer then sees on Sending setup, in English and Arabic. Keyboard and axe throughout.
 */
test('staff see provider health and the switch-on checklists', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const tag = `ph${Date.now()}${test.info().project.name.slice(0, 1)}`.toLowerCase();
  // Real traffic on the web: sends to the dev mailbox, their fake delivery reports through the
  // webhook pipeline, and a forged report that is refused.
  const web = await webPage(browser);
  const { orgSlug } = await webUser(web, { org: true });
  const seed = await web.request.post('/api/dev/messaging', {
    form: { org: orgSlug ?? '', action: 'sends', count: '3', local: 'health', tag },
  });
  expect(await seed.json()).toEqual({ queued: 3 });
  expect((await web.request.post('/api/dev/outbox/drain', { form: { org: orgSlug ?? '' } })).ok()).toBe(true);
  expect((await web.request.post('/api/webhooks/email/fake', { data: '{"events":[]}' })).status()).toBe(400);

  await signInStaff(page);
  // Keyboard: the header link, then Enter.
  const link = page.getByRole('link', { name: 'Messaging providers' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Messaging providers', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Provider health, last 24 hours' });
  for (const name of ['Amazon SES (email)', 'Twilio (SMS)', 'WhatsApp Cloud API', 'Pani WhatsApp gateway'])
    await expect(table.getByRole('row').filter({ hasText: name })).toContainText('Not set up');
  const fake = table.getByRole('row').filter({ hasText: 'Fake email provider (development)' });
  await expect(fake).toContainText('Development fake');
  await expect(fake).toContainText(/\d+ verified, [1-9]\d* refused/);
  await expect(fake).not.toContainText('Never');
  await expect(fake).toContainText('webhook');
  await expect(table.getByRole('row').filter({ hasText: 'Dev mailbox (development)' })).toContainText(
    /[1-9]\d* sent/,
  );
  // Checklists: what is automatic and what is the owner's.
  const ses = page.getByRole('list', { name: 'Switch-on checklist: Amazon SES (email)' });
  await expect(ses.getByRole('listitem')).toHaveCount(6);
  await expect(ses.getByRole('listitem').filter({ hasText: 'SES production access granted' })).toContainText(
    "Owner's step",
  );
  await expect(ses.getByRole('listitem').filter({ hasText: 'Config names are set' })).toContainText(
    'Missing: AWS_SES_REGION, AWS_SES_ACCESS_KEY_ID',
  );
  await expect(ses.getByRole('listitem').filter({ hasText: 'EMAIL_PROVIDER=ses' })).toContainText('To do');
  const gateway = page.getByRole('list', { name: 'Switch-on checklist: Pani WhatsApp gateway' });
  await expect(gateway.getByRole('listitem').first()).toContainText('whatsapp.panitechnologies.com');
  await expectAccessible(page);
  // The cross-tenant read is in the access log.
  await page.goto('/access-log');
  await expect(
    page.getByRole('cell', { name: 'staff console: messaging provider health' }).first(),
  ).toBeVisible();
});

test("staff set a tenant's dedicated senders; the organizer sees them (English and Arabic)", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const web = await webPage(browser);
  const { orgSlug } = await webUser(web, { org: true });
  const slug = orgSlug ?? '';
  await web.goto(`/o/${slug}/sending`);
  await expect(web.getByText("Yayatoh's shared number")).toBeVisible();
  await signInStaff(page);
  await openTenant(page, slug, `Test Org ${slug.replace(/^e2e-/, '')}`);
  await page.getByRole('link', { name: 'Messaging: auto-pause and quotas' }).click();
  await expect(page.getByRole('heading', { name: /^Messaging: / })).toBeVisible();
  await expect(page.getByText("SMS: Yayatoh's shared number.")).toBeVisible();
  await expectAccessible(page);

  // Validation: a bad SID.
  const sms = page.getByRole('form', { name: 'Dedicated SMS sender' });
  await sms.getByLabel('Messaging Service SID (MG…)').fill('MG-not-a-sid');
  await sms.getByRole('button', { name: 'Save and check 10DLC status' }).click();
  await expect(
    page.getByText('Enter a Messaging Service SID: MG followed by 32 hexadecimal characters.'),
  ).toBeVisible();
  // A service in review (the fake reads the SID's last character: e = in review), from the keyboard.
  const sid = `MG${Date.now().toString(16).padStart(31, '0').slice(-31)}e`;
  await sms.getByLabel('Messaging Service SID (MG…)').fill(sid);
  await sms.getByLabel('Number people see (optional, +1…)').fill('+1 312 555 0142');
  await sms.getByLabel('Number people see (optional, +1…)').press('Enter');
  await expect(page.getByText('The sender was saved.')).toBeVisible();
  await expect(
    page.getByText(`SMS: Messaging Service ending ${sid.slice(-4)}, 10DLC campaign in review.`),
  ).toBeVisible();
  // WhatsApp: the Cloud API needs a phone number id; the gateway route doesn't.
  const wa = page.getByRole('form', { name: 'WhatsApp route' });
  await wa.getByLabel('Route').selectOption('cloud');
  await wa.getByRole('button', { name: 'Save the WhatsApp route' }).click();
  await expect(page.getByText('The Cloud API needs the phone number id (digits).')).toBeVisible();
  await wa.getByLabel('Route').selectOption('gateway');
  await wa.getByRole('button', { name: 'Save the WhatsApp route' }).click();
  await expect(page.getByText("WhatsApp: the owner's gateway.")).toBeVisible();
  await expectAccessible(page);

  // The organizer sees them read-only, in English and in Arabic.
  await web.reload();
  await expect(web.getByText('Your own number +13125550142')).toBeVisible();
  await expect(web.getByText('In review')).toBeVisible();
  await expect(web.getByText('Pani WhatsApp gateway')).toBeVisible();
  await expect(
    web.getByText(
      "Your own number is used once its 10DLC campaign is verified; until then texts use Yayatoh's shared number.",
    ),
  ).toBeVisible();
  const ar = await (
    await browser.newContext({ baseURL: WEB, storageState: await web.context().storageState() })
  ).newPage();
  await ar.goto(`/ar/o/${slug}/sending`);
  await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(ar.getByText('قيد المراجعة')).toBeVisible();
  await expect(ar.getByText('بوابة واتساب من Pani')).toBeVisible();
  await expectAccessible(ar);

  // Back to the shared number.
  await sms.getByRole('button', { name: 'Use the shared number' }).click();
  await expect(page.getByText('The tenant is back on the shared sender.')).toBeVisible();
  await expect(page.getByText("SMS: Yayatoh's shared number.")).toBeVisible();
});

test('finance staff (no messaging role) and organizers cannot open messaging providers', async ({
  page,
  browser,
}) => {
  const web = await webPage(browser);
  const { email } = await webUser(web, { signIn: false });
  makeStaff(email, 'finance');
  await signInStaff(page, email);
  await expect(page.getByRole('link', { name: 'Messaging providers' })).toHaveCount(0);
  await page.goto('/providers');
  await expect(page).toHaveURL(/\/not-staff$/);
  // Signed out: sign in first.
  const anon = await (await browser.newContext()).newPage();
  await anon.goto('/providers');
  await expect(anon).toHaveURL(/\/sign-in$/);
});
