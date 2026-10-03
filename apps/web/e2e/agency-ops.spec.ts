import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  pickOption,
  signIn,
  type TestUser,
} from './helpers.ts';

/**
 * M6.8b Agency v2 operations: an agency publishes a template and a brand kit to a client, fans a
 * campaign out, names a team and gives a day-of pass; the client applies the kit, revokes a person
 * and detaches, keeping its data. Every test makes its own agency and client (per project,
 * rerunnable). Agency v2 is behind the platform switch `agency_v2`, turned on here through the
 * staff CLI (it stays on: nothing else depends on it being off).
 */

const VIEWER = 'jordan@lakeside.test';
const tag = (what: string) => `${what} ${test.info().project.name} ${Date.now()}`;

test.beforeAll(() => {
  execFileSync('node', ['scripts/agency-v2.ts', '--on', '--reason', 'e2e run', '--by', 'staff:e2e'], {
    cwd: fileURLToPath(new URL('../../worker/', import.meta.url)),
    env: process.env,
  });
});

type Agency = TestUser & { orgSlug: string; templateName: string };

/** A throwaway agency org with a saved template (dev only), its owner signed in on `page`. */
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

async function twoBrowsers(browser: Browser) {
  const agencyPage = await (await browser.newContext()).newPage();
  const clientPage = await (await browser.newContext()).newPage();
  return { agencyPage, clientPage };
}

/** The client gives the agency access from its Agencies page (a step-up command, already verified). */
async function grantFromClient(page: Page, clientSlug: string, agencySlug: string) {
  await page.goto(`/o/${clientSlug}/agencies`);
  await page.getByLabel('Agency address').fill(agencySlug);
  await page.getByRole('radio', { name: 'Manage events' }).check();
  await page.getByRole('button', { name: 'Give access' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'can now work in this organization.' }),
  ).toBeVisible();
}

/** Press a control with the keyboard only (focus, then Space or Enter). */
async function press(page: Page, locator: ReturnType<Page['locator']>, key: 'Space' | 'Enter' = 'Enter') {
  await locator.focus();
  await page.keyboard.press(key);
}

test.describe('agency v2 operations (M6.8b)', () => {
  test.setTimeout(300_000);

  test('publishes a template and a brand kit to a client; private parts stay; the client applies the kit', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agencyName = tag('Fern Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug ?? '';
    await grantFromClient(c, clientSlug, agency.orgSlug);

    // The Library tab: the agency's template, with what stays private and where to publish it.
    await a.goto(`/o/${agency.orgSlug}/agency`);
    await a
      .getByRole('navigation', { name: 'Agency sections' })
      .getByRole('link', { name: 'Library' })
      .click();
    await expect(a).toHaveURL(new RegExp(`/o/${agency.orgSlug}/agency/library$`));
    await expect(a.getByRole('heading', { name: 'Templates' })).toBeVisible();
    const card = a.locator('section').filter({ has: a.getByRole('heading', { name: agency.templateName }) });
    await expect(card.getByText('Published to clients: 0')).toBeVisible();
    // The brand kits start empty, and the empty state points at the form.
    await expect(a.getByText('No brand kits yet')).toBeVisible();
    await expectAccessibleBothModes(a);

    // Private notes and parts, saved with the keyboard.
    await card.getByLabel('Private notes').fill('Our margin notes, never for clients');
    await press(a, card.getByRole('checkbox', { name: 'Keep the checkout questions private' }), 'Space');
    await press(a, card.getByRole('button', { name: 'Save privacy' }));
    await expect(card.getByRole('status').filter({ hasText: 'Privacy saved.' })).toBeVisible();
    await a.reload();
    await expect(card.getByLabel('Private notes')).toHaveValue('Our margin notes, never for clients');
    await expect(card.getByText('Questions private', { exact: true })).toBeVisible();

    // Publishing needs a client; then it lands in the client's own templates (keyboard only).
    await press(a, card.getByRole('button', { name: `Publish ${agency.templateName}` }));
    await expect(card.getByText('Choose at least one client.')).toBeVisible();
    await press(a, card.getByRole('checkbox', { name: /Test Org/ }), 'Space');
    await press(a, card.getByRole('button', { name: `Publish ${agency.templateName}` }));
    await expect(card.getByRole('list', { name: 'Result for each client' })).toContainText('Published');
    await a.reload();
    await expect(card.getByText('Published to clients: 1')).toBeVisible();

    // A brand kit: validation, then created and published.
    await a.getByRole('button', { name: 'Create brand kit' }).click();
    await expect(a.getByText('This field is required.').first()).toBeVisible();
    await a.getByLabel('Kit name').fill('Fern spring');
    await a.getByLabel('Accent colour').fill('green');
    await a.getByRole('button', { name: 'Create brand kit' }).click();
    await expect(a.getByText('Enter a colour like #2F6B4F.')).toBeVisible();
    await expect(a.getByLabel('Kit name')).toHaveValue('Fern spring');
    await a.getByLabel('Accent colour').fill('#2F6B4F');
    await a.getByRole('button', { name: 'Create brand kit' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Brand kit Fern spring created.' })).toBeVisible();
    // The form is empty again for the next kit; the same name is refused on the field.
    await expect(a.getByLabel('Kit name')).toHaveValue('');
    await a.getByLabel('Kit name').fill('Fern spring');
    await a.getByLabel('Accent colour').fill('#000000');
    await a.getByRole('button', { name: 'Create brand kit' }).click();
    await expect(a.getByText('You already have a brand kit with this name.')).toBeVisible();
    await a.reload();
    const kit = a.locator('section').filter({ has: a.getByRole('heading', { name: 'Fern spring' }) });
    await kit.getByRole('checkbox', { name: /Test Org/ }).check();
    await kit.getByRole('button', { name: 'Publish Fern spring' }).click();
    await expect(kit.getByRole('list', { name: 'Result for each client' })).toContainText('Published');
    await expectAccessible(a);

    // The client: its own copy of the template, and the kit to apply.
    await c.goto(`/o/${clientSlug}/templates`);
    await expect(c.getByRole('heading', { name: agency.templateName })).toBeVisible();
    await c.goto(`/o/${clientSlug}/agencies`);
    const kits = c.getByRole('table', { name: 'Brand kits from your agencies' });
    await expect(kits.getByRole('row').filter({ hasText: 'Fern spring' })).toContainText('Not applied');
    const received = c.getByRole('table', { name: 'Received from your agencies' });
    await expect(received).toContainText('Event template');
    await expect(received).toContainText('Brand kit');
    await expectAccessibleBothModes(c);
    await press(c, kits.getByRole('button', { name: 'Apply Fern spring' }));
    await expect(kits.getByRole('row').filter({ hasText: 'Fern spring' })).toContainText('Applied');
    await c.reload();
    await expect(kits.getByRole('row').filter({ hasText: 'Fern spring' })).toContainText('Applied');

    // Arabic, right to left.
    await a.goto(`/ar/o/${agency.orgSlug}/agency/library`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(a.getByRole('heading', { name: 'القوالب' })).toBeVisible();
    await expectAccessible(a);
  });

  test('fans one campaign out as each client’s own draft, with validation and history', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agency = await newAgency(a, tag('Moss Agency'));
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug ?? '';
    await grantFromClient(c, clientSlug, agency.orgSlug);

    await a.goto(`/o/${agency.orgSlug}/agency/campaigns`);
    await expect(a.getByText('No fan-outs yet.')).toBeVisible();
    await expectAccessibleBothModes(a);
    await a.getByRole('button', { name: 'Fan out' }).click();
    await expect(a.getByText('This field is required.')).toHaveCount(4);
    await expect(a.getByText('Choose at least one client.')).toBeVisible();
    await expect(a.getByLabel('Campaign name')).toHaveAttribute('aria-invalid', 'true');

    const name = tag('Spring news');
    await a.getByLabel('Campaign name').fill(name);
    await a.getByLabel('Subject').fill('Spring is here');
    await a.getByLabel('Heading').fill('Spring at last');
    await a.getByLabel('Message').fill('Our spring season opens soon.');
    await press(a, a.getByRole('radio', { name: /attended any of the client/ }), 'Space');
    await press(a, a.getByRole('checkbox', { name: /Test Org/ }), 'Space');
    await press(a, a.getByRole('button', { name: 'Fan out' }));
    await expect(a.getByRole('status').filter({ hasText: 'Fan-out finished.' })).toBeVisible();
    // A new client has no postal address yet: its draft waits for it.
    await expect(a.getByRole('list', { name: 'Result for each client' })).toContainText(
      'Draft created: the client must add its postal address before sending',
    );
    await a.reload();
    const history = a.getByRole('table', { name: 'Fan-outs' });
    await expect(history.getByRole('row').filter({ hasText: name })).toContainText('Drafts');
    await expectAccessible(a);

    // The client has the campaign as its own draft, and sees where it came from.
    await c.goto(`/o/${clientSlug}/campaigns`);
    await expect(c.getByText(name)).toBeVisible();
    await c.goto(`/o/${clientSlug}/agencies`);
    await expect(c.getByRole('table', { name: 'Received from your agencies' })).toContainText('Campaign');

    await a.goto(`/ar/o/${agency.orgSlug}/agency/campaigns`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(a);
  });

  test('names a team, gives and revokes a day-of pass; the client revokes a person and detaches with all its data', async ({
    browser,
  }) => {
    const { agencyPage: a, clientPage: c } = await twoBrowsers(browser);
    const agencyName = tag('Ivy Agency');
    const agency = await newAgency(a, agencyName);
    const client = await newUser(c, { org: true, event: 'published', twoFactor: true });
    const clientSlug = client.orgSlug ?? '';
    await grantFromClient(c, clientSlug, agency.orgSlug);
    // The client's events reach the agency's day-of picker through its snapshots.
    await a.goto(`/o/${agency.orgSlug}/agency`);
    await a.getByRole('button', { name: 'Refresh numbers' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Numbers refreshed for 1 client.' })).toBeVisible();

    await a.getByRole('navigation', { name: 'Agency sections' }).getByRole('link', { name: 'Team' }).click();
    await expect(a).toHaveURL(new RegExp(`/o/${agency.orgSlug}/agency/team$`));
    const teamTable = a.getByRole('table', { name: /^Team for / });
    await expect(teamTable).toContainText('No team named');
    await expectAccessibleBothModes(a);

    // The owner (the first person, chosen by default) joins the client's team.
    await pickOption(a.getByLabel('Person').first(), { index: 0 });
    await pickOption(a.getByLabel('Access').first(), 'manager');
    await a.getByRole('button', { name: 'Add to team' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Added to the team.' })).toBeVisible();
    await expect(teamTable.getByRole('row')).toHaveCount(2);
    await expect(teamTable).toContainText('Manage events');

    // A day-of pass for the client's event, then revoked.
    const passes = a.getByRole('table', { name: /^Day-of passes for / });
    await expect(passes).toContainText('No day-of passes.');
    await pickOption(a.getByLabel('Person').nth(1), { index: 0 });
    await pickOption(a.getByLabel('Event'), { index: 0 });
    await a.getByRole('button', { name: 'Give day-of pass' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Day-of pass given.' })).toBeVisible();
    await expect(passes.getByRole('row')).toHaveCount(2);
    await expectAccessible(a);
    await press(a, passes.getByRole('button', { name: /^Revoke access for / }));
    await expect(passes).toContainText('No day-of passes.');

    // The client sees the agency's team member and can take the place away.
    await c.goto(`/o/${clientSlug}/agencies`);
    const people = c.getByRole('table', { name: 'People from your agencies' });
    await expect(people).toContainText('Team member');
    await expectAccessibleBothModes(c);
    await press(c, people.getByRole('button', { name: /^Revoke access for / }));
    await expect(people).toContainText('No team named and no day-of passes');

    // Detach: the client keeps everything; the agency loses the client.
    await c.getByRole('button', { name: `Detach from ${agencyName}` }).click();
    await expect(c.getByRole('status').filter({ hasText: `You left ${agencyName}.` })).toBeVisible();
    await expect(c.getByText('You keep all your data.')).toBeVisible();
    await c.goto(`/o/${clientSlug}`);
    await expect(c.getByRole('heading', { level: 1 })).toBeVisible();
    await a.goto(`/o/${agency.orgSlug}/agency/team`);
    await expect(a.getByText('No clients yet')).toBeVisible();

    await c.goto(`/ar/o/${clientSlug}/agencies`);
    await expect(c.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(c);
  });

  test('a viewer sees no agency v2 controls; a non-agency org has no agency pages', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events/agencies');
    await expect(page.getByRole('button', { name: /^Detach from / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Revoke access for / })).toHaveCount(0);
    for (const tab of ['library', 'campaigns', 'team']) {
      const res = await page.goto(`/o/lakeside-events/agency/${tab}`);
      expect(res?.status()).toBe(404);
    }
  });
});
