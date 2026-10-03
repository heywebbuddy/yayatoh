import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { getEventBySlugQuery } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { saveLayoutCommand } from '@yayatoh/seating';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { ports } from '@yayatoh/testing';
import {
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  pickOption,
  pickWithKeyboard,
} from './helpers.ts';

/**
 * M6.14b venues: a venue org shares a plan of its library with a partner organizer
 * (`venue_partner`); the organizer copies it into an event (copy-on-use); the venue sees the use
 * (name, date, status, organizer only); unsharing applies on the next request; a viewer reads only.
 * Promoted placements: an org promotes a marketplace listing; search shows it labelled
 * "Promoted" above the results until the promotion ends. Every test makes its own orgs
 * (throwaway accounts), so projects and reruns never share data.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const tag = () => `${Date.now().toString(36)}${test.info().project.name.slice(0, 1)}`;

test.afterAll(async () => {
  await closePools();
});

async function orgIdOf(slug: string) {
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return org.orgId;
}

/** A plan in the venue's library (6 seats in one row), saved as its owner would. */
async function libraryPlan(orgSlug: string, name: string) {
  const orgId = await orgIdOf(orgSlug);
  await executeCommand(
    saveLayoutCommand,
    {
      name,
      doc: {
        version: 1,
        width: 2000,
        height: 1000,
        underlay: null,
        sections: [],
        items: [buildRow({ label: 'A', count: 6, x: 100, y: 100 })],
      },
    },
    createCtx({ orgId, actor: { type: 'system', name: 'e2e.venue' } }),
    ports,
  );
}

async function eventName(orgSlug: string, slug: string) {
  const orgId = await orgIdOf(orgSlug);
  const e = await executeQuery(
    getEventBySlugQuery,
    { slug },
    createCtx({ orgId, actor: { type: 'system', name: 'e2e.venue' } }),
    ports,
  );
  return e.name;
}

const portalUrl = (org: string, locale = '') => `${locale}/o/${org}/venue-portal`;

async function addPartner(page: Page, slug: string) {
  const form = page.locator('#new-partner');
  await form.getByLabel("Organizer's address").fill(slug);
  await form.getByRole('button', { name: 'Add partner' }).click();
}

test.describe('venue portal and shared layouts (M6.14b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a venue shares a plan; the organizer uses it for an event; the venue sees the use; unsharing applies at once', async ({
    page,
    browser,
  }) => {
    const t = tag();
    const venue = await newUser(page, { org: true, twoFactor: true });
    const venueOrg = venue.orgSlug as string;
    const plan = `Grand Hall ${t}`;
    await libraryPlan(venueOrg, plan);

    // The organizer: a separate account and org with an event.
    const organizerCtx = await browser.newContext();
    const org = await organizerCtx.newPage();
    const organizer = await newUser(org, { org: true, twoFactor: true, event: 'published', profile: 'gala' });
    const organizerOrg = organizer.orgSlug as string;
    const organizerEvent = await eventName(organizerOrg, organizer.eventSlug as string);
    // Before any grant, the organizer sees no shared plans.
    await org.goto(`/o/${organizerOrg}/seating-library`);
    await expect(org.getByRole('heading', { name: 'Seating library', level: 1 })).toBeVisible();
    await expect(org.getByRole('heading', { name: 'Shared by venues' })).toHaveCount(0);

    // The venue portal, empty states first (reachable from the sidebar).
    await page.goto(`/o/${venueOrg}`);
    // The sidebar links it (in the menu on small screens).
    await expect(page.locator('a[href$="/venue-portal"]').first()).toBeAttached();
    await page.goto(portalUrl(venueOrg));
    await expect(page.getByRole('heading', { name: 'Venue portal', level: 1 })).toBeVisible();
    await expect(page.getByText('No partners yet')).toBeVisible();
    await expect(page.getByText('No partner event uses your plans yet')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Every validation error, at the field.
    await addPartner(page, '');
    await expect(page.getByText('Enter an address: lowercase letters, numbers and hyphens.')).toBeVisible();
    await expect(page.getByLabel("Organizer's address")).toHaveAttribute('aria-invalid', 'true');
    await addPartner(page, `nobody-${t}`);
    await expect(
      page.getByText('No organizer has that address. Check the link they gave you.'),
    ).toBeVisible();
    await addPartner(page, venueOrg);
    await expect(page.getByText("That's your own organization.")).toBeVisible();
    await expectAccessible(page);

    // Add the organizer by keyboard (their page link works too).
    await page.getByLabel("Organizer's address").fill(`https://yayatoh.com/o/${organizerOrg}`);
    await page.getByLabel("Organizer's address").press('Enter');
    await expect(
      page.getByText(`${organizerOrg} is now a partner. Share a plan with them below.`),
    ).toBeVisible();
    await page.reload();
    const partners = page.getByRole('table', { name: 'Partner organizers' });
    await expect(partners.getByRole('row').filter({ hasText: organizerOrg })).toBeVisible();

    // Share the plan with them (keyboard).
    const card = page.getByTestId('portal-plan').filter({ hasText: plan });
    await expect(card).toContainText('6 seats · Not used by a partner event yet');
    await expect(card.getByText('Not shared')).toBeVisible();
    const share = card.getByRole('button', { name: new RegExp(`^Share ${plan} with `) });
    await share.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Plan shared. Your partner can use it now.')).toBeVisible();
    await expect(page.getByTestId('portal-plan').filter({ hasText: plan })).toContainText('Shared with');
    await expectAccessible(page);

    // The organizer sees it and uses it for their event: validation first, then by keyboard.
    await org.reload();
    await expect(org.getByRole('heading', { name: 'Shared by venues' })).toBeVisible();
    await expect(org.getByTestId('shared-layout').filter({ hasText: plan })).toContainText(/From Test Org /);
    await expectAccessibleBothModes(org);
    await org.getByRole('button', { name: 'Use for this event' }).click();
    await expect(org.getByText('Choose an event.')).toBeVisible();
    await pickOption(org.getByLabel('Shared plan'), { label: new RegExp(plan) });
    await pickWithKeyboard(org.getByLabel('Event', { exact: true }), { label: organizerEvent });
    await expect(org.getByText("The venue will see this event's name, date and status.")).toBeVisible();
    await org.getByRole('button', { name: 'Use for this event' }).focus();
    await org.keyboard.press('Enter');
    await expect(
      org.getByText(new RegExp(`^${organizerEvent} now uses the plan from Test Org `)),
    ).toBeVisible();
    await org.getByRole('link', { name: `Open the seating of ${organizerEvent}` }).click();
    await expect(org.getByRole('application', { name: 'Seating plan' })).toBeVisible();

    // The venue sees the use (allowlisted columns), and the count on the plan, after a reload.
    await page.goto(portalUrl(venueOrg));
    const uses = page.getByRole('table', { name: 'Partner events using your plans' });
    const row = uses.getByRole('row').filter({ hasText: organizerEvent });
    await expect(row).toContainText(plan);
    await expect(row).toContainText('Published');
    await expect(page.getByTestId('portal-plan').filter({ hasText: plan })).toContainText(
      'Used by 1 partner event',
    );
    await expectAccessibleBothModes(page);

    // Unshare: the organizer's next request no longer offers it; the use already made stays.
    await page.goto(portalUrl(venueOrg));
    await page
      .getByTestId('portal-plan')
      .filter({ hasText: plan })
      .getByRole('button', { name: new RegExp(`^Stop sharing ${plan} with `) })
      .click();
    await expect(
      page.getByText('Sharing stopped. Events that already use the plan keep their copy.'),
    ).toBeVisible();
    await expect(page.getByRole('table', { name: 'Partner events using your plans' })).toContainText(
      organizerEvent,
    );
    await org.goto(`/o/${organizerOrg}/seating-library`);
    await expect(org.getByRole('heading', { name: 'Seating library', level: 1 })).toBeVisible();
    await expect(org.getByTestId('shared-layout').filter({ hasText: plan })).toHaveCount(0);

    // Removing the partner hides their events from the venue at once.
    await page
      .getByRole('button', { name: / as a partner$/ })
      .first()
      .click();
    await expect(page.getByText('Partner removed. They no longer see your plans.')).toBeVisible();
    await expect(page.getByText('No partner event uses your plans yet')).toBeVisible();
    await organizerCtx.close();

    // Arabic, right to left (last: the locale sticks for the session).
    await page.goto(portalUrl(venueOrg, '/ar'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'بوابة المكان', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer reads the portal without any control; an organizer without a grant sees no private plan', async ({
    page,
    browser,
  }) => {
    const t = tag();
    const venue = await newUser(page, { org: true, twoFactor: true });
    const venueOrg = venue.orgSlug as string;
    await libraryPlan(venueOrg, `Private Room ${t}`);
    const viewerCtx = await browser.newContext();
    const viewer = await viewerCtx.newPage();
    await newUser(viewer, { join: [`${venueOrg}:viewer`] });
    await viewer.goto(portalUrl(venueOrg));
    await expect(viewer.getByRole('heading', { name: 'Venue portal', level: 1 })).toBeVisible();
    await expect(
      viewer.getByText('You can view the portal. Owners and admins choose partners and what is shared.'),
    ).toBeVisible();
    await expect(viewer.getByTestId('portal-plan').filter({ hasText: `Private Room ${t}` })).toBeVisible();
    await expect(viewer.getByLabel("Organizer's address")).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Share / })).toHaveCount(0);
    await expect(
      viewer.getByText('Ask an owner or admin to add the organizers you work with.'),
    ).toBeVisible();
    await expectAccessible(viewer);
    await viewerCtx.close();

    // Another org's owner: nothing of the venue's private plans.
    const otherCtx = await browser.newContext();
    const other = await otherCtx.newPage();
    const outsider = await newUser(other, { org: true, twoFactor: true });
    await other.goto(`/o/${outsider.orgSlug}/seating-library`);
    await expect(other.getByRole('heading', { name: 'Seating library', level: 1 })).toBeVisible();
    await expect(other.getByText(`Private Room ${t}`)).toHaveCount(0);
    await expect(other.getByRole('heading', { name: 'Shared by venues' })).toHaveCount(0);
    await otherCtx.close();
  });
});

test.describe('promoted placements (M6.14b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an org promotes a marketplace listing; search labels it "Promoted" until the promotion ends', async ({
    page,
    browser,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const orgSlug = owner.orgSlug as string;
    const name = await eventName(orgSlug, owner.eventSlug as string);
    // The search index (the dev fake) learns about the org's listing.
    const indexed = await page.request.post('/api/dev/search/run', { form: { org: orgSlug } });
    expect(indexed.status()).toBe(200);

    await page.goto(`/o/${orgSlug}`);
    await expect(page.locator('a[href$="/promotions"]').first()).toBeAttached();
    await page.goto(`/o/${orgSlug}/promotions`);
    await expect(page.getByRole('heading', { name: 'Promotions', level: 1 })).toBeVisible();
    await expect(page.getByText('Promotions are free during the beta; pricing comes later.')).toBeVisible();
    const row = page
      .getByRole('table', { name: 'Your public events' })
      .getByRole('row')
      .filter({ hasText: name });
    await expect(row).toContainText('Not promoted');
    await expectAccessibleBothModes(page);

    // Not promoted yet: search shows no promoted placement.
    const search = await page.context().newPage();
    await search.goto(`${MARKET}/search?q=${encodeURIComponent(name)}`);
    await expect(search.locator('h1')).toBeVisible();
    await expect(search.getByRole('heading', { name: 'Promoted', exact: true })).toHaveCount(0);

    // Promote for 14 days, by keyboard.
    await pickWithKeyboard(row.getByLabel(`How long to promote ${name}`), { label: '14 days' });
    await row.getByRole('button', { name: `Promote ${name}` }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Promotion started. The event now shows as promoted in matching searches.'),
    ).toBeVisible();
    const promotedRow = page
      .getByRole('table', { name: 'Your public events' })
      .getByRole('row')
      .filter({ hasText: name });
    await expect(promotedRow).toContainText('Promoted until');
    await page.reload();
    await expect(promotedRow).toContainText('Promoted until');

    // Search: labelled as promoted, above the results.
    await search.reload();
    const promoted = search.getByRole('region', { name: 'Promoted' });
    await expect(promoted).toBeVisible();
    const item = promoted.getByRole('listitem').filter({ hasText: name });
    await expect(item).toBeVisible();
    await expect(item.getByText('Promoted', { exact: true })).toBeVisible();
    await expectAccessibleBothModes(search);
    // Arabic, right to left (its own context: the locale sticks for a session).
    const arabicCtx = await browser.newContext();
    const arabic = await arabicCtx.newPage();
    await arabic.goto(`${MARKET}/ar/search?q=${encodeURIComponent(name)}`);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.getByRole('region', { name: 'مُروَّج' })).toBeVisible();
    await expectAccessible(arabic);
    await arabicCtx.close();
    // A search it doesn't match shows no placement.
    await search.goto(`${MARKET}/search?q=nothing${Date.now().toString(36)}`);
    await expect(search.getByRole('region', { name: 'Promoted' })).toHaveCount(0);

    // End it: gone from search on the next request.
    await promotedRow.getByRole('button', { name: `End the promotion of ${name}` }).click();
    await expect(page.getByText('Promotion ended.')).toBeVisible();
    await expect(promotedRow).toContainText('Ended');
    await search.goto(`${MARKET}/search?q=${encodeURIComponent(name)}`);
    await expect(search.getByRole('region', { name: 'Promoted' })).toHaveCount(0);
    await search.close();
  });

  test('a viewer reads promotions without controls', async ({ page, browser }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const viewerCtx = await browser.newContext();
    const viewer = await viewerCtx.newPage();
    await newUser(viewer, { join: [`${owner.orgSlug}:viewer`] });
    await viewer.goto(`/o/${owner.orgSlug}/promotions`);
    await expect(viewer.getByRole('heading', { name: 'Promotions', level: 1 })).toBeVisible();
    await expect(
      viewer.getByText('You can view promotions. Marketing roles start and end them.'),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: /^Promote / })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewerCtx.close();
  });
});
