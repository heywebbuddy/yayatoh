import { type Browser, expect, type Page, test } from '@playwright/test';
import { deleteSegmentCommand } from '@yayatoh/audiences';
import { closePools } from '@yayatoh/db';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { campaignScenario, ports } from '@yayatoh/testing';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  newUser,
  pickOption,
  pickWithKeyboard,
} from './helpers.ts';

/**
 * M6.4d Mailchimp, Klaviyo and HubSpot through the real UI against the fake IntegrationAuth port
 * and the recorded-shape fakes: connect each, choose the audience and list, map fields, sync, and
 * see an unsubscribe (or a complaint, or an opt-out) come back as a consent change; a deleted
 * audience is flagged; managers read only, viewers are refused; keyboard only; axe in both
 * themes; Arabic RTL.
 */
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

const stampOf = () => `${Date.now()}${test.info().project.name.slice(0, 1)}`;

/** A fresh org (owner signed in, one published event) with two subscribers and one contact without consent. */
async function orgWithPeople(page: Page) {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  const stamp = stampOf();
  const people = {
    amina: `amina+${stamp}@fans.test`,
    bo: `bo+${stamp}@fans.test`,
    cy: `cy+${stamp}@fans.test`,
  };
  const audience = `Fans ${stamp}`;
  const segmentId = await campaignScenario(
    org.orgId,
    [
      { email: people.amina, name: 'Amina Diallo', consent: 'granted' },
      { email: people.bo, name: 'Bo Chen', consent: 'granted' },
      { email: people.cy, name: 'Cy Park', consent: null },
    ],
    audience,
  );
  return { slug, orgId: org.orgId, people, audience, segmentId };
}

async function runSyncs(page: Page, org: string) {
  const res = await page.request.post('/api/dev/integrations/run', { form: { org } });
  expect(res.ok()).toBe(true);
}

/** The person (or the provider) acts in the marketing tool itself. */
async function atProvider(
  page: Page,
  connection: string,
  action: 'unsubscribe' | 'clean' | 'complain',
  email: string,
  list = '',
) {
  const res = await page.request.post('/api/dev/integrations/fake', {
    form: { connection, action, email, list },
  });
  expect(res.ok()).toBe(true);
}

/** Connect a connector through the fake consent screen; returns the connection id. */
async function connect(page: Page, org: string, name: string): Promise<string> {
  await page.goto(`/o/${org}/integrations`);
  await page.getByRole('button', { name: `Connect ${name}` }).click();
  await expect(page.getByRole('heading', { name: `Connect ${name} to Yayatoh?` })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText(`${name} is connected. The first sync starts shortly.`)).toBeVisible();
  const id = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

const changesTable = (page: Page, name: string) => page.getByRole('table', { name: `Consent changes from ${name}` });

async function openAs(browser: Browser, opts: Parameters<typeof newUser>[1]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await newUser(page, opts);
  return page;
}

test.describe('marketing integrations (M6.4d)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('Mailchimp: connect, choose the audience and list, map, sync, and an unsubscribe comes back', async ({
    page,
  }) => {
    const { slug, people, audience } = await orgWithPeople(page);
    await page.goto(`/o/${slug}/integrations`);
    await expect(page.getByRole('heading', { name: 'Mailchimp' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'HubSpot' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Klaviyo' })).toBeVisible();
    const connection = await connect(page, slug, 'Mailchimp');

    // Nothing is sent until an audience and a list are chosen.
    await expect(page.getByRole('heading', { name: 'Audience', level: 2 })).toBeVisible();
    await expect(page.getByText('No audience chosen yet')).toBeVisible();
    await expect(page.getByText(/Consent comes first/).first()).toBeVisible();
    await expect(changesTable(page, 'Mailchimp')).toContainText('Nothing has come back from Mailchimp yet.');
    await expectAccessibleBothModes(page);

    await pickOption(page.getByLabel('Who is sent'), { label: audience });
    await pickOption(page.getByLabel('Mailchimp list'), { label: 'Event attendees' });
    await page.getByRole('button', { name: 'Save audience' }).click();
    await expect(page.getByText('Audience saved. The next sync sends it.')).toBeVisible();
    await page.reload();
    const current = page.getByTestId('audience-current');
    await expect(current).toContainText(audience);
    await expect(current).toContainText('Event attendees');
    await expectPicked(page.getByLabel('Mailchimp list'), 'mc_list_events');

    // Field mapping for the list: the company goes to a merge field too (a new version).
    const push = page.getByRole('form', { name: 'Out to the provider' });
    await pickOption(push.getByRole('group', { name: 'Company' }).getByLabel('Comes from'), 'company');
    await push.getByRole('button', { name: 'Save export mapping' }).click();
    await expect(page.getByText('Mapping saved as version 2. The next sync uses it.')).toBeVisible();

    await runSyncs(page, slug);
    await page.reload();
    const runs = page.getByRole('table', { name: 'Recent syncs of this integration' });
    // Two subscribers sent (Cy has no consent); the earlier Mailchimp unsubscribe came in.
    await expect(runs.getByRole('row').nth(1)).toContainText('Synced');
    const table = changesTable(page, 'Mailchimp');
    await expect(table).toContainText('left.before@mc-remote.test');
    await expect(table).toContainText('Unsubscribed');
    await expect(table).not.toContainText(people.cy);

    // Amina unsubscribes in Mailchimp: the next sync withdraws her consent here, with Mailchimp as source.
    await atProvider(page, connection, 'unsubscribe', people.amina, 'mc_list_events');
    await runSyncs(page, slug);
    await page.reload();
    const row = changesTable(page, 'Mailchimp').getByRole('row').filter({ hasText: people.amina });
    await expect(row).toContainText('Amina Diallo');
    await expect(row).toContainText('Unsubscribed');
    await expect(row).toContainText('Consent withdrawn · Suppressed');
    await expectAccessibleBothModes(page);
  });

  test('Klaviyo by keyboard only: choose the audience; a spam complaint comes back', async ({ page }) => {
    const { slug, people } = await orgWithPeople(page);
    await page.goto(`/o/${slug}/integrations`);
    const connectButton = page.getByRole('button', { name: 'Connect Klaviyo' });
    await connectButton.focus();
    await page.keyboard.press('Enter');
    const allow = page.getByRole('button', { name: 'Allow' });
    await expect(allow).toBeVisible();
    await allow.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Klaviyo is connected. The first sync starts shortly.')).toBeVisible();
    const connection = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;

    await pickWithKeyboard(page.getByLabel('Who is sent'), { label: 'Everyone with email marketing consent' });
    await pickWithKeyboard(page.getByLabel('Klaviyo list'), { label: 'VIP' });
    await page.getByRole('button', { name: 'Save audience' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Audience saved. The next sync sends it.')).toBeVisible();
    await expect(page.getByTestId('audience-current')).toContainText('Everyone with email marketing consent');

    await runSyncs(page, slug);
    await atProvider(page, connection, 'complain', people.bo, 'KlList02');
    await runSyncs(page, slug);
    await page.reload();
    const table = changesTable(page, 'Klaviyo');
    await expect(table.getByRole('row').filter({ hasText: people.bo })).toContainText('Spam complaint');
    await expect(table).toContainText('bounced.before@kl-remote.test');
    await expect(table.getByRole('row').filter({ hasText: 'bounced.before@kl-remote.test' })).toContainText(
      'Address bounced',
    );
    await expectAccessible(page);
  });

  test('HubSpot: contacts both ways, marketing events, and an opt-out comes back', async ({ page }) => {
    const { slug, people } = await orgWithPeople(page);
    const connection = await connect(page, slug, 'HubSpot');
    await expect(page.getByRole('heading', { name: 'What syncs with HubSpot' })).toBeVisible();
    await expect(page.getByText(/Every published event becomes a HubSpot marketing event/)).toBeVisible();
    // One mapping per object and direction, named by object.
    await expect(page.getByRole('heading', { name: 'Contacts: Into Yayatoh' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Contacts: Out to the provider' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Marketing events: Out to the provider' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Registrations and attendance: Out to the provider' })).toBeVisible();
    // No audience picker: HubSpot sends every contact with consent.
    await expect(page.getByLabel('Who is sent')).toHaveCount(0);
    await expectAccessibleBothModes(page);

    await runSyncs(page, slug);
    await page.reload();
    const table = changesTable(page, 'HubSpot');
    await expect(table).toContainText('opted.out@hs-remote.test');
    await atProvider(page, connection, 'unsubscribe', people.amina);
    await runSyncs(page, slug);
    await page.reload();
    await expect(table.getByRole('row').filter({ hasText: people.amina })).toContainText(
      'Consent withdrawn · Suppressed',
    );
    // Cy never had consent: HubSpot never got Cy, so nothing about Cy comes back.
    await expect(table).not.toContainText(people.cy);
  });

  test('a deleted audience is flagged; managers read only; viewers are refused', async ({ page, browser }) => {
    const { slug, orgId, audience, segmentId } = await orgWithPeople(page);
    const connection = await connect(page, slug, 'Mailchimp');
    await pickOption(page.getByLabel('Who is sent'), { label: audience });
    await page.getByRole('button', { name: 'Save audience' }).click();
    await expect(page.getByText('Audience saved. The next sync sends it.')).toBeVisible();
    await executeCommand(
      deleteSegmentCommand,
      { segmentId },
      createCtx({ orgId, actor: { type: 'system', name: 'e2e.integrations' } }),
      ports,
    );
    await page.reload();
    await expect(
      page.getByText('The saved audience was deleted, so no one new is sent. Choose another audience.'),
    ).toBeVisible();
    await expectAccessible(page);

    const manager = await openAs(browser, { join: [`${slug}:manager`], twoFactor: true });
    await manager.goto(`/o/${slug}/integrations/${connection}`);
    await expect(manager.getByRole('heading', { name: 'Audience', level: 2 })).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Save audience' })).toHaveCount(0);
    await expect(manager.getByLabel('Who is sent')).toHaveCount(0);
    await expect(changesTable(manager, 'Mailchimp')).toBeVisible();
    await manager.context().close();

    const viewer = await openAs(browser, { join: [`${slug}:viewer`], twoFactor: true });
    const res = await viewer.goto(`/o/${slug}/integrations/${connection}`);
    expect(res?.status()).toBe(404);
    await viewer.context().close();
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const { slug } = await orgWithPeople(page);
    const connection = await connect(page, slug, 'Mailchimp');
    await runSyncs(page, slug);
    await page.goto(`/ar/o/${slug}/integrations/${connection}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الجمهور', level: 2 })).toBeVisible();
    await expect(page.getByRole('table', { name: 'تغييرات الموافقة من Mailchimp' })).toBeVisible();
    await expectAccessible(page);
  });
});
