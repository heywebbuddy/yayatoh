import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessibleBothModes, newUser, pickOption, type TestUser } from './helpers.ts';

/*
 * Phase 6 end-to-end journeys, set B. One journey per track, each chaining the track's real UI
 * flows (fake providers only; every test works in orgs of its own, so it is rerunnable and
 * independent across the three projects):
 *
 *  1. Billing: an org starts on its included plan, previews and confirms an upgrade to Pro
 *     (proration, modules that turn off), a renewal fails (grace, then read-only with a clear
 *     refusal, nothing deleted), it pays and writes return, then the usage page; Arabic RTL last.
 *  2. Agency: a client gives an agency access, the agency refreshes its numbers and acts in the
 *     client (via-agency badge), publishes a template and a brand kit, fans a campaign out, names
 *     a team member, offers to pay the plan, the client applies the kit and accepts the offer;
 *     Arabic RTL last.
 *  3. Virtual: a Zoom-connected org sets hybrid delivery and a stream, an attendee watches, the
 *     provider switches mid-view, a Zoom webinar is created and its attendance webhooks arrive,
 *     and a CE conference in the same org turns attendance into a certificate that anyone can verify;
 *     Arabic RTL last.
 *
 * Each journey has a keyboard-only segment and runs axe in light and dark on its key screens.
 */

const tag = (what: string) => `${what} ${test.info().project.name} ${Date.now()}`;
const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

/** Keyboard only: focus the control, then press the key. */
async function press(
  page: Page,
  target: string | RegExp | Locator,
  key = 'Enter',
  role: 'button' | 'link' = 'button',
) {
  const control =
    typeof target === 'object' && 'focus' in target ? target : page.getByRole(role, { name: target });
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}

async function guest(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

// ───────────────────────────── 1. Billing ─────────────────────────────

const moduleChip = (page: Page, key: string) =>
  page.getByTestId('module-list').locator(`li[data-module="${key}"]`);

async function previewPlan(page: Page, plan: string) {
  const radio = page
    .getByTestId('change-plan')
    .getByRole('radio', { name: new RegExp(`^${plan}: .* a month`) });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await press(page, 'Preview change');
  await expect(page.getByTestId('change-preview')).toBeVisible();
}

async function renewal(
  page: Page,
  slug: string,
  button: 'Fail the renewal payment' | 'Stop retrying the payment',
) {
  await page.goto(`/o/${slug}/plan`);
  await press(page, 'Open the test billing portal');
  await expect(page).toHaveURL(/\/billing\/fake\?/);
  await press(page, button);
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan\\?billing=renewal$`));
}

test.describe('journey: billing (plan change, dunning, usage)', () => {
  test.setTimeout(300_000);

  test('included plan, upgrade to Pro, failed renewal to read-only, paying, usage, Arabic', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    const orgName = tag('Journey Billing');
    const general = page.getByRole('region', { name: 'General' });

    // Reached from Settings: the included plan with every module, nothing charged.
    await page.goto(`/o/${slug}/settings`);
    await page.getByRole('link', { name: 'Plan and modules' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Plan and modules' })).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('Launch standard');
    await expect(moduleChip(page, 'virtual')).toHaveCount(1);
    await expectAccessibleBothModes(page);

    // Keyboard only: preview Pro (validation first), acknowledge the modules that turn off, confirm.
    await press(page, 'Preview change');
    await expect(page.getByText('Choose a plan to preview.')).toBeVisible();
    await previewPlan(page, 'Pro');
    const preview = page.getByTestId('change-preview');
    await expect(preview.getByRole('heading', { name: 'Change to Pro' })).toBeVisible();
    await expect(page.getByTestId('amount-due')).toHaveText('$106.92');
    await expect(page.getByTestId('removed-modules').locator('li[data-module="virtual"]')).toHaveText(
      'Virtual events',
    );
    await expectAccessibleBothModes(page);
    const ack = page.getByRole('checkbox', { name: /^I understand/ });
    await ack.focus();
    await page.keyboard.press('Space');
    await expect(ack).toBeChecked();
    await press(page, 'Confirm change');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan\\?billing=changed$`));
    await expect(page.getByTestId('plan-name')).toHaveText('Pro');
    await expect(page.getByTestId('current-plan').getByText('Active')).toBeVisible();
    await expect(moduleChip(page, 'virtual')).toHaveCount(0);
    await expect(moduleChip(page, 'sessions')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('plan-name')).toHaveText('Pro');

    // A failed renewal: grace (writes still work), then read-only.
    await renewal(page, slug, 'Fail the renewal payment');
    await expect(page.getByTestId('billing-standing')).toHaveAttribute('data-standing', 'grace');
    await page.goto(`/o/${slug}/settings`);
    await expect(page.getByTestId('billing-banner')).toHaveAttribute('data-standing', 'grace');
    await general.getByLabel('Organization name').fill(orgName);
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(general.getByText('Saved.')).toBeVisible();

    await renewal(page, slug, 'Stop retrying the payment');
    await expect(page.getByTestId('billing-standing')).toHaveAttribute('data-standing', 'read_only');
    await expectAccessibleBothModes(page);
    await page.goto(`/o/${slug}/settings`);
    const banner = page.getByTestId('billing-banner');
    await expect(banner).toContainText('This organization is read-only');
    await expect(banner).toContainText('Nothing has been deleted');
    await expect(general.getByLabel('Organization name')).toHaveValue(orgName);
    await general.getByLabel('Organization name').fill(`${orgName} (changed)`);
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(
      general.getByText(
        'This organization is read-only until its subscription is paid. Nothing was saved or deleted.',
      ),
    ).toBeVisible();
    await page.reload();
    await expect(general.getByLabel('Organization name')).toHaveValue(orgName);

    // Pay now from the banner's link, keyboard only: writes return at once.
    await press(page, 'Plan and billing', 'Enter', 'link');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan$`));
    await press(page, 'Pay now');
    await expect(page.getByText('Payment received')).toBeVisible();
    await expect(page.getByTestId('billing-standing')).toHaveCount(0);
    await page.goto(`/o/${slug}/settings`);
    await expect(page.getByTestId('billing-banner')).toHaveCount(0);
    await general.getByLabel('Organization name').fill(`${orgName} (paid)`);
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(general.getByText('Saved.')).toBeVisible();

    // Usage: the subscription sends it to the billing provider; the meters are listed.
    await page.goto(`/o/${slug}/plan`);
    await press(page, 'Usage', 'Enter', 'link');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/plan/usage$`));
    await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible();
    await expect(page.getByText('Usage is sent to your billing provider')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Arabic, right to left (last: the locale sticks to the session).
    await page.goto(`/ar/o/${slug}/plan`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الخطة والوحدات' })).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveText('الاحترافية');
    await expectAccessibleBothModes(page);
  });
});

// ───────────────────────────── 2. Agency ─────────────────────────────

test.beforeAll(() => {
  // Agency v2 sits behind one platform switch (stays on; nothing else depends on it being off).
  execFileSync('node', ['scripts/agency-v2.ts', '--on', '--reason', 'e2e run', '--by', 'staff:e2e'], {
    cwd: fileURLToPath(new URL('../../worker/', import.meta.url)),
    env: process.env,
  });
});

type Agency = TestUser & { orgSlug: string; templateName: string };

async function newAgency(page: Page, name: string): Promise<Agency> {
  const form = new URLSearchParams({ org: 'agency', orgName: name, twoFactor: '1', template: '1' });
  const res = await page.request.post('/api/dev/user', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(res.status()).toBe(200);
  const user = (await res.json()) as TestUser & { templateName?: string };
  if (!user.orgSlug || !user.templateName) throw new Error('no agency org');
  return { ...user, orgSlug: user.orgSlug, templateName: user.templateName };
}

test.describe('journey: agency (clients, templates, fan-out, billing)', () => {
  test.setTimeout(400_000);

  test('grant, act as the agency, publish, fan out, team, billing offer, apply, Arabic', async ({
    browser,
  }) => {
    const a = await guest(browser);
    const c = await guest(browser);
    const agencyName = tag('Journey Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug as string;
    const nav = a.getByRole('navigation', { name: 'Agency sections' });

    // The client gives the agency access (validation first).
    await c.goto(`/o/${clientSlug}/agencies`);
    await c.getByRole('button', { name: 'Give access' }).click();
    await expect(c.getByText('Enter the agency’s address.')).toBeVisible();
    await c.getByLabel('Agency address').fill(agency.orgSlug);
    await c.getByRole('radio', { name: 'Manage events' }).check();
    await c.getByRole('button', { name: 'Give access' }).click();
    await expect(
      c.getByRole('status').filter({ hasText: 'can now work in this organization.' }),
    ).toBeVisible();
    await expectAccessibleBothModes(c);

    // The agency refreshes its numbers: the client is listed.
    await a.goto(`/o/${agency.orgSlug}/agency`);
    await expect(a.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await a.getByRole('button', { name: 'Refresh numbers' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Numbers refreshed for 1 client.' })).toBeVisible();
    await expectAccessibleBothModes(a);

    // Keyboard only: open the client from the list, see the badge, go back.
    await press(a, a.getByRole('link', { name: /^Open Test Org/ }), 'Enter');
    await expect(a).toHaveURL(new RegExp(`/o/${clientSlug}$`));
    await expect(a.getByTestId('via-agency')).toContainText(`via ${agencyName}`);
    await press(a, a.getByRole('link', { name: `Back to ${agencyName}` }), 'Enter');
    await expect(a).toHaveURL(new RegExp(`/o/${agency.orgSlug}/agency$`));

    // Library: publish the template to the client, then a brand kit.
    await nav.getByRole('link', { name: 'Library' }).click();
    await expect(a.getByRole('heading', { name: 'Templates' })).toBeVisible();
    const card = a.locator('section').filter({ has: a.getByRole('heading', { name: agency.templateName }) });
    await press(a, card.getByRole('button', { name: `Publish ${agency.templateName}` }));
    await expect(card.getByText('Choose at least one client.')).toBeVisible();
    await press(a, card.getByRole('checkbox', { name: /Test Org/ }), 'Space');
    await press(a, card.getByRole('button', { name: `Publish ${agency.templateName}` }));
    await expect(card.getByRole('list', { name: 'Result for each client' })).toContainText('Published');
    await expectAccessibleBothModes(a);
    await a.getByLabel('Kit name').fill('Journey kit');
    await a.getByLabel('Accent colour').fill('green');
    await a.getByRole('button', { name: 'Create brand kit' }).click();
    await expect(a.getByText('Enter a colour like #2F6B4F.')).toBeVisible();
    await a.getByLabel('Accent colour').fill('#2F6B4F');
    await a.getByRole('button', { name: 'Create brand kit' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Brand kit Journey kit created.' })).toBeVisible();
    await a.reload();
    const kit = a.locator('section').filter({ has: a.getByRole('heading', { name: 'Journey kit' }) });
    await kit.getByRole('checkbox', { name: /Test Org/ }).check();
    await kit.getByRole('button', { name: 'Publish Journey kit' }).click();
    await expect(kit.getByRole('list', { name: 'Result for each client' })).toContainText('Published');

    // Fan-out: one campaign becomes the client's own draft.
    await nav.getByRole('link', { name: 'Campaigns' }).click();
    await expect(a).toHaveURL(/\/agency\/campaigns$/);
    await a.getByRole('button', { name: 'Fan out' }).click();
    await expect(a.getByText('Choose at least one client.')).toBeVisible();
    const campaign = tag('Journey news');
    await a.getByLabel('Campaign name').fill(campaign);
    await a.getByLabel('Subject').fill('News from the agency');
    await a.getByLabel('Heading').fill('Hello');
    await a.getByLabel('Message').fill('Our season opens soon.');
    await press(a, a.getByRole('radio', { name: /attended any of the client/ }), 'Space');
    await press(a, a.getByRole('checkbox', { name: /Test Org/ }), 'Space');
    await press(a, a.getByRole('button', { name: 'Fan out' }));
    await expect(a.getByRole('status').filter({ hasText: 'Fan-out finished.' })).toBeVisible();
    await expectAccessibleBothModes(a);

    // Team: the owner joins the client's team.
    await nav.getByRole('link', { name: 'Team' }).click();
    await expect(a).toHaveURL(/\/agency\/team$/);
    await pickOption(a.getByLabel('Person').first(), { index: 0 });
    await pickOption(a.getByLabel('Access').first(), 'manager');
    await a.getByRole('button', { name: 'Add to team' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Added to the team.' })).toBeVisible();
    await expect(a.getByRole('table', { name: /^Team for / })).toContainText('Manage events');

    // Billing: the agency offers to pay the plan.
    await nav.getByRole('link', { name: 'Billing', exact: true }).click();
    await expect(a).toHaveURL(/\/agency\/billing$/);
    const clients = a.getByRole('table', { name: 'Clients' });
    const row = clients.getByRole('row').nth(1);
    await expect(row.getByText('Not offered')).toBeVisible();
    await press(a, row.getByRole('button', { name: /^Offer to pay the plan of / }));
    await expect(
      a.getByRole('alert').or(a.getByRole('status')).filter({ hasText: 'Offer sent to' }),
    ).toBeVisible();
    await expectAccessibleBothModes(a);

    // The client: its own template and campaign draft, applies the kit, accepts the offer.
    await c.goto(`/o/${clientSlug}/templates`);
    await expect(c.getByRole('heading', { name: agency.templateName })).toBeVisible();
    await c.goto(`/o/${clientSlug}/campaigns`);
    await expect(c.getByText(campaign)).toBeVisible();
    await c.goto(`/o/${clientSlug}/agencies`);
    const kits = c.getByRole('table', { name: 'Brand kits from your agencies' });
    await expect(kits.getByRole('row').filter({ hasText: 'Journey kit' })).toContainText('Not applied');
    const received = c.getByRole('table', { name: 'Received from your agencies' });
    await expect(received).toContainText('Event template');
    await expect(received).toContainText('Campaign');
    await press(c, kits.getByRole('button', { name: 'Apply Journey kit' }));
    await expect(kits.getByRole('row').filter({ hasText: 'Journey kit' })).toContainText('Applied');
    const billing = c.getByRole('region', { name: 'Agency billing' });
    const offer = billing.getByTestId('agency-billing-offer');
    await expect(offer.getByText(`${agencyName} offers to pay your plan`)).toBeVisible();
    await press(
      c,
      offer.getByRole('button', { name: `Accept the offer from ${agencyName} to pay your plan` }),
    );
    await expect(c.getByText('Agency billing is on: the agency now pays your plan.')).toBeVisible();
    await c.reload();
    await expect(billing.getByTestId('agency-billing-current').getByText('In force')).toBeVisible();
    await expect(kits.getByRole('row').filter({ hasText: 'Journey kit' })).toContainText('Applied');
    await expectAccessibleBothModes(c);

    // Arabic, right to left (last: the locale sticks to the session).
    await a.goto(`/ar/o/${agency.orgSlug}/agency/billing`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(a.getByRole('heading', { name: 'كشف العمولات' })).toBeVisible();
    await expectAccessibleBothModes(a);
    await c.goto(`/ar/o/${clientSlug}/agencies`);
    await expect(c.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(c.getByRole('heading', { name: 'فوترة الوكالة' })).toBeVisible();
    await expectAccessibleBothModes(c);
  });
});

// ───────────────────────────── 3. Virtual ─────────────────────────────

interface Person {
  readonly name: string;
  readonly email: string;
  readonly token: string;
  readonly watch: string;
  readonly ticketType: string;
}
interface Fixture {
  readonly slug: string;
  readonly orgId: string;
  readonly path: string;
  readonly sessions: { id: string; title: string }[];
  readonly people: Person[];
}
const ana = (f: Fixture) => f.people.find((p) => p.name === 'Ana') as Person;

const providerField = (page: Page, title: string) =>
  page.getByRole('combobox', { name: `Video provider for ${title}` });
const keynoteRow = (page: Page) => page.getByRole('row', { name: /Opening keynote/ }).first();
const zoomCard = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, level: 3 }) });
const ruleForm = (page: Page, title: string) => page.getByRole('form', { name: `Credit rule for ${title}` });

async function zoomWebhook(
  page: Page,
  p: { webinar: string; email: string; kind: 'joined' | 'left'; at: Date },
) {
  const signed = await page.request.post('/api/dev/zoom', {
    form: {
      action: 'webhook',
      webinar: p.webinar,
      email: p.email,
      kind: p.kind,
      at: p.at.toISOString(),
      participant: 'p-ana',
    },
  });
  expect(signed.ok()).toBe(true);
  const { body, headers } = (await signed.json()) as { body: string; headers: Record<string, string> };
  const res = await page.request.post('/api/webhooks/zoom', {
    data: body,
    headers: { ...headers, 'content-type': 'application/json' },
  });
  return ((await res.json().catch(() => ({}))) as { outcome?: string }).outcome;
}

test.describe('journey: virtual (delivery, playback, Zoom, CE)', () => {
  test.setTimeout(420_000);

  test('hybrid setup, watching, provider switch, Zoom webinar, CE certificate, Arabic', async ({
    page,
    browser,
  }) => {
    // A new org with a published event, Zoom connected (fake consent), and the dev virtual conference.
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug as string;
    await page.goto(`/o/${org}/integrations`);
    await page.getByRole('button', { name: 'Connect Zoom' }).click();
    await expect(page.getByRole('heading', { name: 'Connect Zoom to Yayatoh?' })).toBeVisible();
    await page.getByRole('button', { name: 'Allow' }).click();
    await expect(page.getByText('Zoom is connected. The first sync starts shortly.')).toBeVisible();
    const res = await page.request.post('/api/dev/virtual', { form: { org, name: `Journey ${stamp()}` } });
    expect(res.ok()).toBe(true);
    const f = (await res.json()) as Fixture;

    // In person until changed: nothing can stream.
    await page.goto(`${f.path}/virtual`);
    await expect(page.getByRole('heading', { name: 'Stream setup', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up a stream for Opening keynote' })).toBeDisabled();
    await expectAccessibleBothModes(page);

    // Keyboard only: Hybrid delivery, Ana's access, the keynote's stream.
    await page
      .getByRole('radio', { name: /^In person/ })
      .first()
      .focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: /^Hybrid/ })).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save delivery' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Delivery saved.')).toBeVisible();
    const type = page.getByRole('group', { name: ana(f).ticketType });
    await type.getByRole('radio', { name: 'In person and online' }).focus();
    await page.keyboard.press('Space');
    await expect(type.getByRole('radio', { name: 'In person and online' })).toBeChecked();
    await press(page, `Save access for ${ana(f).ticketType}`);
    await expect(page.getByText(`Access saved for ${ana(f).ticketType}.`)).toBeVisible();
    await press(page, 'Set up a stream for Opening keynote');
    await expect(page.getByText('Stream ready for Opening keynote.')).toBeVisible();
    await expect(keynoteRow(page).getByTestId('stream-provider')).toHaveText('Mux (test)');
    await expectAccessibleBothModes(page);

    // Ana watches (real heartbeat), Ben's in-person pass has no watch link.
    const a = await guest(browser);
    await a.goto(`/orders/${ana(f).token}`);
    await a.getByRole('link', { name: /Watch online with ticket/ }).click();
    await expect(a.getByRole('heading', { name: 'Watch online', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(a);
    await a.getByRole('link', { name: 'Watch Opening keynote' }).click();
    await a.getByRole('button', { name: 'Start watching' }).click();
    await expect(a.getByTestId('player-status')).toHaveText('Playing');
    await expect(a.getByTestId('watched-minutes')).toHaveText('Watched 1 minute');
    await expectAccessibleBothModes(a);

    // The provider moves to Cloudflare while she watches; she keeps access and her minute.
    await pickOption(providerField(page, 'Opening keynote'), { label: 'Cloudflare Stream (test)' });
    await page.getByRole('button', { name: 'Switch the video provider for Opening keynote' }).click();
    await expect(page.getByText(/Opening keynote now streams on Cloudflare Stream \(test\)/)).toBeVisible();
    await a.getByRole('button', { name: 'Pause' }).click();
    await a.getByRole('button', { name: 'Resume' }).click();
    await expect(a.getByText("The stream moved to another provider. You're still watching.")).toBeVisible();
    await expect(a.getByTestId('watched-minutes')).toHaveText(/Watched [12] minutes?/);

    // A Zoom webinar for the closing panel; join and leave webhooks count once each.
    await page.reload();
    await page.getByRole('button', { name: 'Create a Zoom webinar for Closing panel' }).click();
    await expect(page.getByText('Zoom webinar created for Closing panel.')).toBeVisible();
    await page.reload();
    const panel = zoomCard(page, 'Closing panel');
    await expect(panel.getByTestId('zoom-counts')).toHaveText('Registrants: 1 · Attended: 0');
    await expectAccessibleBothModes(page);
    const webinar = await panel.getByLabel('Zoom webinar ID').inputValue();
    for (const [kind, ago] of [
      ['joined', 20],
      ['left', 2],
    ] as const) {
      const at = new Date(Date.now() - ago * 60_000);
      expect(await zoomWebhook(page, { webinar, email: ana(f).email, kind, at })).toBe('recorded');
      expect(await zoomWebhook(page, { webinar, email: ana(f).email, kind, at })).toBe('duplicate');
    }
    await page.reload();
    await expect(zoomCard(page, 'Closing panel').getByTestId('zoom-counts')).toHaveText(
      'Registrants: 1 · Attended: 1',
    );

    // CE: the dev CE conference of the same org (attendance at past times, through the real
    // commands). Ana's 50 minutes in the room and 15 online earn 2.5 credits.
    const ceRes = await page.request.post('/api/dev/ce', { form: { org, name: `Journey CE ${stamp()}` } });
    expect(ceRes.ok()).toBe(true);
    const ce = (await ceRes.json()) as Fixture;
    const ceAna = ce.people[0] as Person;
    await page.goto(`${ce.path}/ce-credits`);
    await expect(page.getByRole('heading', { name: 'CE credits', level: 1 })).toBeVisible();
    const form = ruleForm(page, 'Morning keynote');
    await form.getByLabel('Credits', { exact: true }).fill('abc');
    await press(page, form.getByRole('button', { name: 'Save the credit rule for Morning keynote' }));
    await expect(form.getByText('Enter credits from 0.01 to 100, with up to two decimals.')).toBeVisible();
    await form.getByLabel('Credits', { exact: true }).fill('1.5');
    await form.getByLabel('Minimum minutes').fill('45');
    await form.getByLabel('In person (door scans)').setChecked(true);
    await form.getByLabel('Online (watch time and Zoom)').setChecked(false);
    await press(page, form.getByRole('button', { name: 'Save the credit rule for Morning keynote' }));
    await expect(page.getByText('Credit rule saved for Morning keynote.')).toBeVisible();
    const clinical = ruleForm(page, 'Clinical update');
    await clinical.getByLabel('Credits', { exact: true }).fill('1');
    await clinical.getByLabel('Minimum minutes').fill('10');
    await clinical.getByLabel('In person (door scans)').setChecked(false);
    await clinical.getByLabel('Online (watch time and Zoom)').setChecked(true);
    await press(page, clinical.getByRole('button', { name: 'Save the credit rule for Clinical update' }));
    await expect(page.getByText('Credit rule saved for Clinical update.')).toBeVisible();
    await press(page, 'Calculate credits and issue certificates');
    await expect(page.getByText('Credits calculated.')).toBeVisible();
    await expect(page.getByTestId('ce-result')).toContainText('New certificates: 1.');
    await page.reload();
    const table = page.getByRole('table', { name: 'Certificates' });
    const row = table.getByRole('row').filter({ hasText: ceAna.name });
    await expect(row).toContainText('2.5');
    await expect(row).toContainText('Issued · revision 1');
    const code = ((await row.getByRole('cell').nth(2).textContent()) ?? '').trim();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const pdf = await page.request.get(
      (await row
        .getByRole('link', { name: `Download the certificate of ${ceAna.name}` })
        .getAttribute('href')) ?? '',
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    await expectAccessibleBothModes(page);

    // Anyone with the code verifies it (a masked name, never the address).
    const v = await guest(browser);
    await v.goto(`/certificates/${ce.orgId}/verify/${code}`);
    await expect(v.getByText('Valid', { exact: true })).toBeVisible();
    await expect(v.getByText('Ana L.', { exact: true })).toBeVisible();
    await expect(v.getByText(ceAna.email)).toHaveCount(0);
    await expectAccessibleBothModes(v);

    // Arabic, right to left (last: the locale sticks to the session).
    await page.goto(`/ar${f.path}/virtual`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'إعداد البث', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/ar${ce.path}/ce-credits`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'ساعات التعليم المستمر', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    await v.goto(`/ar/certificates/${ce.orgId}/verify/${code}`);
    await expect(v.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(v.getByRole('heading', { name: 'التحقق من شهادة', level: 1 })).toBeVisible();
  });
});
