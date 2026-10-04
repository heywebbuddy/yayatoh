import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { ATTRIBUTION_FIXTURE, attributionScenario } from '@yayatoh/testing';
import { expectAccessibleBothModes, expectPicked, inOptions, newUser, pickOption } from './helpers.ts';

const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

/**
 * M6.2b end to end: the curated explorer (hand-computed multi-touch attribution for the fixture
 * campaign, validation, saved views, CSV export), organizer alert rules (create, edit, switch
 * off, delete; the rule's alert in Alerts) and scheduled PDF reports (schedule, edit, send once
 * per period, download). Keyboard only, axe in both themes, Arabic RTL, and what lower roles
 * can't see or do.
 */
type Scenario = Awaited<ReturnType<typeof attributionScenario>>;
const stampOf = () => `${Date.now().toString(36)}${test.info().project.name.slice(0, 1)}`;

async function orgWithData(page: Page): Promise<{ slug: string; s: Scenario; email: string }> {
  // `event: 'published'` also accepts the platform terms (publishing needs them).
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, s: await attributionScenario(org.orgId), email: owner.email };
}

async function member(browser: Browser, slug: string, role: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = await newUser(page, { join: [`${slug}:${role}`] });
  return { page, email: user.email };
}

const results = (page: Page) => page.getByTestId('explore-results');
const row = (page: Page, label: string) => results(page).locator('tbody tr').filter({ hasText: label });

async function explore(page: Page, opts: Record<string, string>) {
  for (const [label, value] of Object.entries(opts))
    await pickOption(page.getByLabel(label, { exact: true }), value);
  await page.getByTestId('explore-apply').click();
}

test.describe('explorer and attribution (M6.2b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('attributed revenue matches the hand-computed numbers for all three models', async ({ page }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(`/o/${slug}/analytics`);
    await page.getByTestId('analytics-tab-explore').click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/analytics/explore`));
    await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible();
    await expect(page.getByTestId('analytics-tab-explore')).toHaveAttribute('aria-current', 'page');
    await explore(page, {
      Measure: 'attributed_revenue',
      'Break down by': 'source',
      'Attribution model': 'linear',
      Event: s.eventId,
    });
    await expect(page).toHaveURL(/measure=attributed_revenue/);
    await expect(row(page, 'instagram')).toContainText('$13.33');
    await expect(row(page, 'yayatoh')).toContainText('$13.33');
    await expect(row(page, 'partner-news')).toContainText('$3.34');
    await expect(row(page, 'podcast')).toContainText('$5.00');
    await expect(row(page, 'google.com')).toContainText('$5.00');
    await expect(row(page, 'Total')).toContainText('$40.00');
    await expect(page.getByText('any leftover cent goes to the last visit')).toBeVisible();
    await expectAccessibleBothModes(page);

    await explore(page, { 'Attribution model': 'first' });
    await expect(row(page, 'instagram')).toContainText('$20.00');
    await expect(row(page, 'yayatoh')).toContainText('$10.00');
    await expect(row(page, 'podcast')).toContainText('$10.00');
    await expect(row(page, 'partner-news')).toHaveCount(0);
    await explore(page, { 'Attribution model': 'last' });
    await expect(row(page, 'yayatoh')).toContainText('$20.00');
    await expect(row(page, 'partner-news')).toContainText('$10.00');
    await expect(row(page, 'google.com')).toContainText('$10.00');
    // By campaign: the messaging campaign by its link's name fallback, UTM campaigns by name.
    await explore(page, { 'Attribution model': 'linear', 'Break down by': 'campaign' });
    await expect(row(page, 'autumn-social')).toContainText('$13.33');
    await expect(row(page, 'None')).toContainText('$5.00');
    // Attributed orders, linear by channel; the URL keeps the choice through a reload.
    await explore(page, { Measure: 'attributed_orders', 'Break down by': 'channel' });
    await expect(row(page, 'email')).toContainText('1.16');
    await expect(row(page, 'Total')).toContainText('3.00');
    await page.reload();
    await expectPicked(page.getByLabel('Measure', { exact: true }), 'attributed_orders');
    await expect(row(page, 'Total')).toContainText('3.00');
    expect(ATTRIBUTION_FIXTURE.attributedMinor).toBe(4000);
  });

  test('says what is wrong, and what to do when there is nothing', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    await page.goto(`/o/${owner.orgSlug}/analytics/explore`);
    await expect(page.getByText('Nothing to show for this choice')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show the last 12 months' })).toBeVisible();
    await expectAccessibleBothModes(page);
    await explore(page, { 'Break down by': 'source' });
    await expect(
      page.getByText('Channel, source and campaign work only with attributed orders or revenue.'),
    ).toBeVisible();
    await expect(page.getByLabel('Break down by', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await explore(page, { 'Break down by': 'period', Period: 'custom' });
    await expect(page.getByText('Enter both dates for a custom period.')).toBeVisible();
    await page.getByLabel('From', { exact: true }).fill('2027-03-10');
    await page.getByLabel('To', { exact: true }).fill('2027-03-01');
    await page.getByTestId('explore-apply').click();
    await expect(page.getByText('The end date is before the start date.')).toBeVisible();
    await expect(page.getByLabel('To', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessibleBothModes(page);
  });

  test('saved views (keyboard only), CSV export, and deleting a view', async ({ page }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(
      `/o/${slug}/analytics/explore?measure=attributed_revenue&dim=source&model=linear&range=30d&view=day&event=${s.eventId}`,
    );
    await expect(row(page, 'Total')).toContainText('$40.00');
    // Export exactly what is shown.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('explore-export').click(),
    ]);
    const csv = readFileSync((await download.path()) as string, 'utf8');
    expect(csv).toContain('Source,Currency,Attributed revenue');
    expect(csv).toContain('instagram,USD,13.33');
    expect(csv).toContain('Total,USD,40.00');
    // Save it with the keyboard only.
    const name = `Linear by source ${stampOf()}`;
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('save-view')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').getByText('View saved')).toBeVisible();
    const views = page.getByTestId('saved-views');
    await expect(views.getByRole('link', { name })).toBeVisible();
    // Same name again: an inline error.
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByTestId('save-view').click();
    await expect(page.getByText('You already have a view with this name.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    // Opening it from elsewhere brings the same choice back.
    await page.goto(`/o/${slug}/analytics/explore`);
    await views.getByRole('link', { name }).click();
    await expect(page).toHaveURL(/measure=attributed_revenue/);
    await expect(row(page, 'Total')).toContainText('$40.00');
    await expectAccessibleBothModes(page);
    await page.getByRole('button', { name: `Delete the view ${name}` }).click();
    await expect(page.getByRole('status').getByText('View deleted')).toBeVisible();
    await expect(page.getByText('No saved views yet.')).toBeVisible();
  });

  test('a viewer gets counts but no money; a scanner is refused everywhere', async ({ page, browser }) => {
    const { slug, s } = await orgWithData(page);
    const { page: viewer } = await member(browser, slug, 'viewer');
    await viewer.goto(`/o/${slug}/analytics/explore`);
    const measure = viewer.getByLabel('Measure', { exact: true });
    await inOptions(measure, async (list) => {
      await expect(list.locator('[role="option"][data-value="attributed_revenue"]')).toHaveCount(0);
      await expect(list.locator('[role="option"][data-value="gross"]')).toHaveCount(0);
      await expect(list.locator('[role="option"][data-value="attributed_orders"]')).toHaveCount(1);
    });
    // A money URL falls back to counts; nothing shows money.
    await viewer.goto(
      `/o/${slug}/analytics/explore?measure=attributed_revenue&dim=source&event=${s.eventId}`,
    );
    await expectPicked(measure, 'registrations');
    expect(await viewer.locator('main').innerText()).not.toMatch(/\$|USD/);
    const csv = await viewer.request.get(`/o/${slug}/analytics/explore/export?measure=gross&dim=event`);
    expect(await csv.text()).not.toMatch(/USD/);
    await viewer.goto(`/o/${slug}/analytics/explore?measure=attributed_orders&dim=source&event=${s.eventId}`);
    await expect(row(viewer, 'Total')).toContainText('3.00');

    const { page: scanner } = await member(browser, slug, 'scanner');
    for (const path of ['explore', 'alerts', 'reports', 'explore/export'])
      expect((await scanner.goto(`/o/${slug}/analytics/${path}`))?.status()).toBe(404);
  });

  test('Arabic: right to left and translated', async ({ page }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(
      `/ar/o/${slug}/analytics/explore?measure=attributed_orders&dim=source&event=${s.eventId}`,
    );
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'استكشاف' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'أقسام التحليلات' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});

test.describe('organizer alert rules (M6.2b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('create (keyboard only), fire into Alerts, edit, switch off and on, delete', async ({ page }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(`/o/${slug}/analytics/alerts`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alert rules' })).toBeVisible();
    await expect(page.getByText('No alert rules yet')).toBeVisible();
    await expectAccessibleBothModes(page);
    const name = `Busy day ${stampOf()}`;
    // Keyboard only: type the name, then walk the fields.
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type(name);
    await pickOption(page.getByLabel('Measure', { exact: true }), 'registrations');
    await pickOption(page.getByLabel('When it', { exact: true }), 'above');
    await page.getByLabel('Threshold', { exact: true }).focus();
    await page.keyboard.type('3');
    await pickOption(page.getByLabel('Over', { exact: true }), '1');
    await pickOption(page.getByLabel('Event', { exact: true }), s.eventId);
    await page.getByTestId('alert-rule-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').getByText('Rule created')).toBeVisible();
    const rule = page.locator('tbody tr').filter({ hasText: name });
    await expect(rule).toContainText('Firing');
    await expect(rule).toContainText('Registrations is at least 3 · Today');
    await expect(rule).toContainText('4');
    // Its alert reaches the alerts engine (the worker's relay, as dev runs it).
    expect((await page.request.post('/api/dev/outbox/drain', { form: { org: slug } })).ok()).toBe(true);
    await page.goto(`/o/${slug}/alerts`);
    await expect(page.getByText(`Alert rule “${name}” is firing`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open alert rules' }).first()).toBeVisible();

    // Edit: a higher threshold clears it.
    await page.goto(`/o/${slug}/analytics/alerts`);
    await page.goto((await rule.getByRole('link', { name: `Edit ${name}` }).getAttribute('href')) as string);
    await expect(page.getByRole('heading', { level: 1, name: 'Edit alert rule' })).toBeVisible();
    await expect(page.getByLabel('Threshold', { exact: true })).toHaveValue('3');
    await page.waitForLoadState('load');
    await page.getByLabel('Threshold', { exact: true }).fill('100');
    await page.getByTestId('alert-rule-submit').click();
    await expect(page.getByRole('status').getByText('Changes saved')).toBeVisible();
    await expect(rule).toContainText('OK');
    await page.request.post('/api/dev/outbox/drain', { form: { org: slug } });
    await page.goto(`/o/${slug}/alerts`);
    await expect(page.getByText(`Alert rule “${name}” is firing`)).toHaveCount(0);

    await page.goto(`/o/${slug}/analytics/alerts`);
    await rule.getByRole('button', { name: `Turn off ${name}` }).click();
    await expect(page.getByRole('status').getByText('Rule turned off')).toBeVisible();
    await expect(rule).toContainText('Off');
    await page.reload();
    await expect(rule).toContainText('Off');
    await rule.getByRole('button', { name: `Turn on ${name}` }).click();
    await expect(page.getByRole('status').getByText('Rule turned on')).toBeVisible();
    await rule.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(page.getByRole('status').getByText('Rule deleted')).toBeVisible();
    await expect(rule).toHaveCount(0);
  });

  test('validation messages next to their fields', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/o/${slug}/analytics/alerts`);
    await page.getByLabel('Threshold', { exact: true }).fill('5');
    await page.getByTestId('alert-rule-submit').click();
    await expect(page.getByText('Enter a name of up to 80 characters.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    const name = `Rule ${stampOf()}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Threshold', { exact: true }).fill('lots');
    await page.getByTestId('alert-rule-submit').click();
    await expect(page.getByText('Enter a number of 0 or more.')).toBeVisible();
    await expect(page.getByLabel('Threshold', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await pickOption(page.getByLabel('When it', { exact: true }), 'rise');
    await page.getByLabel('Threshold', { exact: true }).fill('5000');
    await page.getByTestId('alert-rule-submit').click();
    await expect(page.getByText('Enter a percentage between 1 and 1000.')).toBeVisible();
    await pickOption(page.getByLabel('When it', { exact: true }), 'above');
    await pickOption(page.getByLabel('Measure', { exact: true }), 'net');
    await page.getByLabel('Threshold', { exact: true }).fill('12.50');
    await page.getByTestId('alert-rule-submit').click();
    await expect(page.getByText('Choose a currency for a money rule.')).toBeVisible();
    await expect(page.getByLabel('Currency', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await pickOption(page.getByLabel('Currency', { exact: true }), 'USD');
    await page.getByTestId('alert-rule-submit').click();
    await expect(page.getByRole('status').getByText('Rule created')).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: name })).toContainText('$12.50');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Threshold', { exact: true }).fill('1');
    await page.getByTestId('alert-rule-submit').click();
    await expect(page.getByText('A rule with this name already exists.')).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('a viewer sees count rules only and cannot change them; Arabic RTL', async ({ page, browser }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/o/${slug}/analytics/alerts`);
    const stamp = stampOf();
    for (const [name, measure, threshold, currency] of [
      [`Counts ${stamp}`, 'checkins', '10', ''],
      [`Money ${stamp}`, 'gross', '100', 'USD'],
    ] as const) {
      await page.getByLabel('Name', { exact: true }).fill(name);
      await pickOption(page.getByLabel('Measure', { exact: true }), measure);
      await page.getByLabel('Threshold', { exact: true }).fill(threshold);
      if (currency) await pickOption(page.getByLabel('Currency', { exact: true }), currency);
      await page.getByTestId('alert-rule-submit').click();
      await expect(page.getByRole('status').getByText('Rule created')).toBeVisible();
    }
    const editHref = await page
      .locator('tbody tr')
      .filter({ hasText: `Counts ${stamp}` })
      .getByRole('link', { name: `Edit Counts ${stamp}` })
      .getAttribute('href');
    const { page: viewer } = await member(browser, slug, 'viewer');
    await viewer.goto(`/o/${slug}/analytics/alerts`);
    await expect(viewer.getByText('You can see these rules but not change them.')).toBeVisible();
    await expect(viewer.getByTestId('alert-rule-form')).toHaveCount(0);
    await expect(viewer.locator('tbody tr').filter({ hasText: `Counts ${stamp}` })).toBeVisible();
    await expect(viewer.getByText(`Money ${stamp}`)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Turn off|Delete/ })).toHaveCount(0);
    expect((await viewer.goto(editHref as string))?.status()).toBe(404);
    await expectAccessibleBothModes(viewer);

    await page.goto(`/ar/o/${slug}/analytics/alerts`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'قواعد التنبيه' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});

test.describe('scheduled PDF reports (M6.2b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('schedule (keyboard only), send once per period, download, edit, switch off, delete', async ({
    page,
  }) => {
    const { slug, email } = await orgWithData(page);
    await page.goto(`/o/${slug}/analytics/reports`);
    await expect(page.getByRole('heading', { level: 1, name: 'Scheduled reports' })).toBeVisible();
    await expect(page.getByText('No scheduled reports yet')).toBeVisible();
    await expect(page.getByText('No report has been sent yet.')).toBeVisible();
    await expectAccessibleBothModes(page);
    const name = `Weekly sales ${stampOf()}`;
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type(name);
    await pickOption(page.getByLabel('How often', { exact: true }), 'weekly');
    await pickOption(page.getByLabel('Send at', { exact: true }), '7');
    // The owner is ticked already.
    await expect(page.getByRole('checkbox', { name: /\(you\)/ })).toBeChecked();
    await page.getByTestId('report-schedule-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').getByText('Report scheduled')).toBeVisible();
    const sched = page
      .getByRole('region', { name: 'Schedules' })
      .locator('tbody tr')
      .filter({ hasText: name });
    await expect(sched).toContainText('Weekly');
    await expect(sched).toContainText('1 member');
    await expect(sched).toContainText('On');

    // The worker's tick, as dev runs it: last week's report goes out once.
    for (let i = 0; i < 2; i++) {
      const res = await page.request.post('/api/dev/analytics/run', { form: { org: slug, reports: '1' } });
      expect(res.ok()).toBe(true);
    }
    expect((await page.request.post('/api/dev/outbox/drain', { form: { org: slug } })).ok()).toBe(true);
    await page.reload();
    const recent = page.getByRole('region', { name: 'Recent reports' });
    await expect(recent.locator('tbody tr').filter({ hasText: name })).toHaveCount(1);
    await expect(recent.locator('tbody tr').filter({ hasText: name })).toContainText('Sent');
    const link = recent.getByRole('link', { name: /Download Weekly sales/ });
    const href = (await link.getAttribute('href')) as string;
    const pdf = await page.request.get(href);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const mails = (await (
      await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`)
    ).json()) as {
      subject: string;
    }[];
    expect(mails.filter((m) => m.subject.startsWith(`Your report “${name}”`))).toHaveLength(1);

    // Edit, switch off and on, delete.
    // Open the edit page from its link with a full load (a change made while the client
    // navigation is still settling could be reset; people are never that fast).
    await page.goto((await sched.getByRole('link', { name: `Edit ${name}` }).getAttribute('href')) as string);
    await expectPicked(page.getByLabel('How often', { exact: true }), 'weekly');
    // Fully loaded: a change made before hydration would be reset to the saved value.
    await page.waitForLoadState('load');
    await pickOption(page.getByLabel('How often', { exact: true }), 'monthly');
    await expectPicked(page.getByLabel('How often', { exact: true }), 'monthly');
    await page.getByTestId('report-schedule-submit').click();
    await expect(page.getByRole('status').getByText('Changes saved')).toBeVisible();
    await expect(sched).toContainText('Monthly');
    await sched.getByRole('button', { name: `Turn off ${name}` }).click();
    await expect(page.getByRole('status').getByText('Schedule turned off')).toBeVisible();
    await expect(sched).toContainText('Off');
    await sched.getByRole('button', { name: `Turn on ${name}` }).click();
    await expect(page.getByRole('status').getByText('Schedule turned on')).toBeVisible();
    await sched.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(page.getByRole('status').getByText('Schedule deleted')).toBeVisible();
    await expect(sched).toHaveCount(0);
  });

  test('validation, a viewer’s view and Arabic RTL', async ({ page, browser }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/o/${slug}/analytics/reports`);
    await page.getByRole('checkbox', { name: /\(you\)/ }).uncheck();
    await page.getByTestId('report-schedule-submit').click();
    await expect(page.getByText('Enter a name of up to 80 characters.')).toBeVisible();
    await expect(page.getByText('Choose at least one member.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    const name = `Daily ${stampOf()}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('checkbox', { name: /\(you\)/ }).check();
    await page.getByTestId('report-schedule-submit').click();
    await expect(page.getByRole('status').getByText('Report scheduled')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByTestId('report-schedule-submit').click();
    await expect(page.getByText('A schedule with this name already exists.')).toBeVisible();
    await expectAccessibleBothModes(page);
    const editHref = await page
      .locator('tbody tr')
      .filter({ hasText: name })
      .getByRole('link', { name: `Edit ${name}` })
      .getAttribute('href');

    const { page: viewer } = await member(browser, slug, 'viewer');
    await viewer.goto(`/o/${slug}/analytics/reports`);
    await expect(viewer.getByTestId('report-schedule-form')).toHaveCount(0);
    await expect(viewer.getByText(name)).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'Recent reports' })).toBeVisible();
    expect((await viewer.goto(editHref as string))?.status()).toBe(404);

    await page.goto(`/ar/o/${slug}/analytics/reports`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'التقارير المجدولة' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
