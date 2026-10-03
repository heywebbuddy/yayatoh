import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectPicked, newUser, pickOption, signIn, WEDDING_OWNER } from './helpers.ts';

/**
 * M4.2a social workspace: the Wedding and Gala starter templates (profile, modules, navigation,
 * checklist), the wedding route and API sweep (no conference or ticketing section, direct URLs
 * refused), the vocabulary sweep (guests, RSVP and hosts, never attendees, registration or
 * organizers), and event teams (P4-8): co-hosts and planners invited by email to one event.
 */

const ORG = '/o/rosewood-weddings';
const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

interface Captured {
  subject: string;
  html: string;
}

/** A new wedding or gala from its starter template; returns the event's console path. */
async function fromStarter(
  page: Page,
  starter: 'wedding' | 'gala',
  name: string,
  opts: { keyboard?: boolean; org?: string } = {},
) {
  await page.goto(`${opts.org ?? ORG}/templates`);
  const card = page.locator(`[data-starter="${starter}"]`);
  if (opts.keyboard) {
    await card.locator('summary').focus();
    await page.keyboard.press('Enter');
    await card.getByLabel('Name of the new event').focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    await card.getByLabel('Starts', { exact: true }).fill('2027-09-18T16:00');
    await card.getByRole('button', { name: 'Create event' }).focus();
    await page.keyboard.press('Enter');
  } else {
    await card.locator('summary').click();
    await card.getByLabel('Name of the new event').fill(name);
    await card.getByLabel('Starts', { exact: true }).fill('2027-09-18T16:00');
    await card.getByRole('button', { name: 'Create event' }).click();
  }
  await expect(page).toHaveURL(/\/e\/[a-z0-9-]+\/setup-guide$/);
  return new URL(page.url()).pathname.replace(/^\/en/, '').replace(/\/setup-guide$/, '');
}

/** The console sidebar (on phones it sits closed in the menu; its links are read all the same). */
const sidebar = (page: Page) => page.locator('nav[aria-label="Main navigation"]').first();

async function navLabels(page: Page): Promise<string[]> {
  // The label of each item (a badge such as "2/7" sits beside it).
  return (await sidebar(page).locator('a span.truncate').allTextContents()).map((l) => l.trim());
}

async function status(page: Page, path: string): Promise<number> {
  const res = await page.goto(path);
  return res?.status() ?? 0;
}

/** The emailed invitation link (delivers the org's messages: only for a test's own org). */
async function inviteLink(page: Page, org: string, email: string): Promise<string> {
  let link = '';
  await expect
    .poll(async () => {
      await page.request.post('/api/dev/outbox/drain', { form: { org: org.replace('/o/', '') } });
      const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
      const mail = ((await res.json()) as Captured[]).find((m) => /invited to help/.test(m.subject));
      link = /href="(https?:\/\/[^"]+\/invite\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
      return link;
    })
    .toMatch(/\/invite\/[0-9a-f-]{36}~/);
  return new URL(link).pathname;
}

async function invite(page: Page, base: string, email: string, role: 'Co-host' | 'Planner') {
  await page.goto(`${base}/team`);
  await page.getByLabel('Email address').fill(email);
  await pickOption(page.getByLabel('Role', { exact: true }), { label: role });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
}

test.describe('starter templates (M4.2a)', () => {
  test('Wedding and Gala create events with their modules, navigation and checklist', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, WEDDING_OWNER);
    await page.goto(`${ORG}/templates`);
    await expect(page.getByRole('heading', { name: 'Starter templates' })).toBeVisible();
    const wed = page.locator('[data-starter="wedding"]');
    await expect(wed).toContainText(
      'Sections: Guests, RSVP, Seating, Seat finder, Website, Gallery, Messages',
    );
    await expect(wed).toContainText('Checklist: Guest list added, RSVP deadline set, Floor plan chosen');
    await expect(page.locator('[data-starter="gala"]')).toContainText('Tickets & Orders');
    await expectAccessible(page);

    // Validation: a name is needed.
    await wed.locator('summary').click();
    await wed.getByLabel('Starts', { exact: true }).fill('2027-09-18T16:00');
    await wed.getByRole('button', { name: 'Create event' }).click();
    await expect(wed.getByText('Check this value.')).toBeVisible();
    await expect(page).toHaveURL(/\/templates$/);

    // Keyboard only: a wedding from its starter lands on its setup guide.
    const wedding = await fromStarter(page, 'wedding', `Amina & Tomas ${stamp()}`, { keyboard: true });
    const guide = page.getByRole('list', { name: 'Readiness checklist' });
    for (const key of ['guestsAdded', 'rsvpDeadlineSet', 'floorPlanChosen', 'guestSitePublished'])
      await expect(guide.locator(`[data-rule="${key}"]`)).toBeVisible();
    await expect(guide.locator('[data-rule="ticketsCreated"]')).toHaveCount(0);
    // Built since the batch 3c merge (M4.1a): the guest list item counts and opens the Guests page.
    const guests = guide.locator('[data-rule="guestsAdded"]');
    await expect(guests.getByText('Coming soon')).toHaveCount(0);
    await expect(guests.getByRole('link')).toHaveAttribute('href', new RegExp(`${wedding}/guests$`));
    // Not built yet: "coming soon", linking to the placeholder page (never a broken link).
    const rsvp = guide.locator('[data-rule="rsvpDeadlineSet"]');
    await expect(rsvp.getByText('Coming soon')).toBeVisible();
    await expect(guide.locator('[data-rule="floorPlanChosen"]').getByText('Coming soon')).toHaveCount(0);
    await rsvp.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`${wedding}/rsvp$`));
    await expect(page.getByText('This area is being built')).toBeVisible();
    await expectAccessible(page);

    // Choosing a floor plan ticks its item.
    await page.goto(`${wedding}/setup-guide`);
    await expect(page.locator('[data-rule="floorPlanChosen"]')).toContainText('Pick a floor plan');
    await page.goto(`${wedding}/seating`);
    await page.getByLabel('Round tables').fill('4');
    await page.getByLabel('Seats per table').fill('8');
    await page.getByRole('button', { name: 'Create plan' }).click();
    await expect(page.getByRole('application', { name: 'Seating plan' })).toBeVisible();
    await page.goto(`${wedding}/setup-guide`);
    await expect(page.locator('[data-rule="floorPlanChosen"]')).toContainText('Done');

    // A gala keeps tickets, and asks for tables & sponsors (M4.2b: built, no longer coming soon).
    const gala = await fromStarter(page, 'gala', `Spring Gala ${stamp()}`);
    await expect(page.locator('[data-rule="ticketsCreated"]')).toBeVisible();
    await expect(page.locator('[data-rule="tablesSponsors"]')).toBeVisible();
    await expect(page.locator('[data-rule="tablesSponsors"]').getByText('Coming soon')).toHaveCount(0);
    expect(await navLabels(page)).toEqual(
      expect.arrayContaining(['Tickets & Orders', 'Guests', 'Tables & Sponsors']),
    );
    expect(await status(page, `${gala}/tickets-orders`)).toBe(200);
  });

  test('the templates page and a wedding setup guide in Arabic (RTL)', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    const wedding = await fromStarter(page, 'wedding', `Rtl wedding ${stamp()}`);
    await page.goto(`/ar${ORG}/templates`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قوالب البداية' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${wedding}/setup-guide`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('قريبًا').first()).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('wedding route sweep and vocabulary (M4.2a)', () => {
  test('a wedding shows no conference or ticketing module, and their URLs are refused', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    const wedding = await fromStarter(page, 'wedding', `Sweep ${stamp()}`);
    const labels = await navLabels(page);
    for (const hidden of [
      'Tickets & Orders',
      'Attendees',
      'Registration',
      'Sessions',
      'Speakers',
      'Analysis',
      'Marketing',
      'On-site',
      'Reviews',
    ])
      expect(labels).not.toContain(hidden);
    for (const shown of [
      'Guests',
      'RSVP',
      'Seating',
      'Seat finder',
      'Website',
      'Gallery',
      'Messages',
      'Day-of',
      'Team',
    ])
      expect(labels).toContain(shown);
    for (const path of [
      'tickets-orders',
      'attendees',
      'attendees/import',
      'analysis',
      'analysis/bookings',
      'marketing',
      'onsite',
      'sessions',
      'speakers',
      'exhibitors',
      'sponsors',
      'reviews',
      'registration',
      'orders/0190f5f6-0000-7000-8000-000000000001',
      'tables-sponsors',
    ])
      expect(await status(page, `${wedding}/${path}`), path).toBe(404);
    expect(await status(page, `${wedding}/seating`)).toBe(200);
    expect(await status(page, `${wedding}/seat-finder`)).toBe(200);
    // The same event path works in Arabic, and refuses the same way.
    expect(await status(page, `/ar${wedding}/tickets-orders`)).toBe(404);
  });

  test('every wedding and gala screen uses the profile words', async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, WEDDING_OWNER);
    const walk = async (base: string, forbidden: RegExp) => {
      const links = await sidebar(page)
        .locator('a')
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname));
      const paths = [...new Set(links.map((p) => p.replace(/^\/en/, '')).filter((p) => p.startsWith(base)))];
      expect(paths.length).toBeGreaterThan(10);
      for (const p of paths) {
        await page.goto(p);
        const bad = (await page.locator('body').innerText()).split('\n').filter((l) => forbidden.test(l));
        expect(bad, p).toEqual([]);
      }
    };
    const wedding = await fromStarter(page, 'wedding', `Words ${stamp()}`);
    // A wedding: guests, RSVP and hosts; and no tickets at all.
    await walk(wedding, /\b(attendees?|registrations?|organi[sz]ers?|tickets?|ticket holders?)\b/i);
    const gala = await fromStarter(page, 'gala', `Gala words ${stamp()}`);
    // A gala: guests and hosts (it keeps tickets).
    await walk(gala, /\b(attendees?|organi[sz]ers?)\b/i);
  });
});

test.describe('event team: co-hosts and planners (M4.2a, P4-8)', () => {
  test('an owner invites a planner and a co-host; each sees exactly their pages; revoking removes access', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    // The planner and co-host: new accounts, in their own browsers.
    const plannerPage = await (await browser.newContext()).newPage();
    const planner = await newUser(plannerPage, { name: 'Pat Planner' });
    const cohostPage = await (await browser.newContext()).newPage();
    const cohost = await newUser(cohostPage, { name: 'Casey Cohost' });

    // The owner of an org of their own (its mail is delivered here, nobody else's).
    const owner = await newUser(page, { org: true, twoFactor: true, name: 'Olive Owner' });
    const ORG = `/o/${owner.orgSlug}`;
    const wedding = await fromStarter(page, 'wedding', `Team wedding ${stamp()}`, { org: ORG });
    const other = await fromStarter(page, 'wedding', `Other wedding ${stamp()}`, { org: ORG });
    await page.goto(`${wedding}/team`);
    await expect(page.getByRole('heading', { name: 'Event team' })).toBeVisible();
    await expect(page.getByText('No co-hosts or planners yet')).toBeVisible();
    await expectAccessible(page);

    // Keyboard only: invite the planner.
    await page.getByLabel('Email address').focus();
    await page.keyboard.type(planner.email);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Role', { exact: true })).toBeFocused();
    await expectPicked(page.getByLabel('Role', { exact: true }), 'planner');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Invitation sent.')).toBeVisible();
    const pending = page
      .getByRole('region', { name: 'Pending invitations' })
      .or(page.locator('section[aria-labelledby="event-pending-heading"]'));
    await expect(pending.getByRole('listitem').filter({ hasText: planner.email })).toContainText('Planner');
    // A second pending invitation for the same address is refused, with a reason.
    await page.getByLabel('Email address').fill(planner.email);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('An invitation is already pending for this address.')).toBeVisible();
    await invite(page, wedding, cohost.email, 'Co-host');
    await expectAccessible(page);

    // The planner accepts and lands on a console listing just their event.
    await plannerPage.goto(await inviteLink(page, ORG, planner.email));
    await expect(plannerPage.getByRole('heading', { name: /^Help with Team wedding/ })).toBeVisible();
    await expect(plannerPage.getByText(/as Planner\. You'll see this event only\./)).toBeVisible();
    await expectAccessible(plannerPage);
    await plannerPage.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(plannerPage).toHaveURL(new RegExp(`${ORG}$`));
    await expect(plannerPage.getByRole('heading', { name: 'Your events' })).toBeVisible();
    const cards = plannerPage.getByRole('list', { name: 'Your events' }).getByRole('listitem');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Planner');
    expect(await navLabels(plannerPage)).toEqual(['Home']);
    await expectAccessible(plannerPage);
    // Org pages and payouts are refused.
    for (const path of ['payouts', 'team', 'settings', 'finance', 'templates', 'events/new'])
      expect(await status(plannerPage, `${ORG}/${path}`), path).toBe(404);
    // Another event of the same org is refused.
    expect(await status(plannerPage, other)).toBe(404);

    // The planner's event: exactly guests, RSVP, seating, seat finder, website, gallery, messages, day-of.
    await plannerPage.goto(wedding);
    expect(await navLabels(plannerPage)).toEqual([
      'Home',
      'Guests',
      'RSVP',
      'Seating',
      'Seat finder',
      'Website',
      'Gallery',
      'Messages',
      'Day-of',
    ]);
    await expectAccessible(plannerPage);
    for (const path of [
      'team',
      'details',
      'content',
      'access',
      'setup-guide',
      'dates',
      'copy',
      'tickets-orders',
    ])
      expect(await status(plannerPage, `${wedding}/${path}`), path).toBe(404);
    expect(await status(plannerPage, `${wedding}/seating`)).toBe(200);
    expect(await status(plannerPage, `${wedding}/gallery`)).toBe(200);
    // Arabic: the planner's console is right-to-left.
    await plannerPage.goto(`/ar${ORG}`);
    await expect(plannerPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(plannerPage.getByRole('heading', { name: 'مناسباتك' })).toBeVisible();
    await expectAccessible(plannerPage);
    await plannerPage.goto(`/en${ORG}`);

    // The co-host accepts: the whole event, with its team; still no org pages.
    await cohostPage.goto(await inviteLink(page, ORG, cohost.email));
    await cohostPage.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(cohostPage.getByRole('heading', { name: 'Your events' })).toBeVisible();
    await cohostPage.goto(wedding);
    const cohostNav = await navLabels(cohostPage);
    for (const label of ['Setup guide', 'Guests', 'Details', 'Team']) expect(cohostNav).toContain(label);
    // Every page the co-host is shown opens (no error page) and nothing outside their event leaks.
    const cohostLinks = await sidebar(cohostPage)
      .locator('a')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname));
    for (const p of [...new Set(cohostLinks)].filter((x) => x.startsWith(wedding))) {
      expect(await status(cohostPage, p), p).toBe(200);
      await expect(cohostPage.getByRole('button', { name: 'Try again' }), p).toHaveCount(0);
    }
    // And the planner's pages.
    for (const p of ['', '/seating', '/seat-finder', '/guests', '/day-of'].map((x) => `${wedding}${x}`)) {
      expect(await status(plannerPage, p), p).toBe(200);
      await expect(plannerPage.getByRole('button', { name: 'Try again' }), p).toHaveCount(0);
    }
    expect(await status(cohostPage, `${ORG}/payouts`)).toBe(404);
    expect(await status(cohostPage, other)).toBe(404);
    await cohostPage.goto(`${wedding}/team`);
    await expect(cohostPage.getByRole('button', { name: 'Send invitation' })).toBeVisible();
    await expect(cohostPage.getByRole('row').filter({ hasText: 'Pat Planner' })).toContainText('Planner');
    await expectAccessible(cohostPage);

    // The owner sees both on the team, changes the planner's role and back (audited).
    await page.goto(`${wedding}/team`);
    const table = page.getByRole('table', { name: 'Event team' });
    await expect(table.getByRole('row').filter({ hasText: 'Casey Cohost' })).toContainText('Co-host');
    await pickOption(table.getByLabel('Role for Pat Planner', { exact: true }), { label: 'Co-host' });
    await table.getByRole('button', { name: 'Save role for Pat Planner' }).click();
    await expect(page.getByText("Pat Planner's role was changed.")).toBeVisible();
    await plannerPage.goto(wedding);
    expect(await navLabels(plannerPage)).toContain('Team');
    // Back to planner (from a fresh page, so the notice below is this change's).
    await page.reload();
    await pickOption(
      page.getByRole('table', { name: 'Event team' }).getByLabel('Role for Pat Planner', { exact: true }),
      { label: 'Planner' },
    );
    await page
      .getByRole('table', { name: 'Event team' })
      .getByRole('button', { name: 'Save role for Pat Planner' })
      .click();
    await expect(page.getByText("Pat Planner's role was changed.")).toBeVisible();
    // Persists after reload.
    await page.reload();
    await expectPicked(
      page.getByRole('table', { name: 'Event team' }).getByLabel('Role for Pat Planner', { exact: true }),
      'planner',
    );

    // Revoking: the planner loses the event (and the org) on their next request.
    await page.getByRole('button', { name: 'Remove Pat Planner' }).click();
    await page.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(page.getByText('Pat Planner was removed.')).toBeVisible();
    expect(await status(plannerPage, wedding)).toBe(404);
    await plannerPage.goto('/o');
    await expect(plannerPage.getByText("You're not in an organization yet")).toBeVisible();
    await page.reload();
    await expect(page.getByRole('table', { name: 'Event team' }).getByText('Pat Planner')).toHaveCount(0);
  });

  test('a viewer sees an event team read-only; the Arabic team page is right-to-left', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    const res = await page.goto('/o/lakeside-events/e/lakeside-open-house/team');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Event team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await expectAccessible(page);
    await page.goto('/ar/o/lakeside-events/e/lakeside-open-house/team');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'فريق المناسبة' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a withdrawn invitation cannot be used', async ({ page, browser }) => {
    const p = await (await browser.newContext()).newPage();
    const guest = await newUser(p, { name: 'Wes Withdrawn' });
    const owner = await newUser(page, { org: true, twoFactor: true });
    const ORG = `/o/${owner.orgSlug}`;
    const wedding = await fromStarter(page, 'wedding', `Withdrawn ${stamp()}`, { org: ORG });
    await invite(page, wedding, guest.email, 'Planner');
    const link = await inviteLink(page, ORG, guest.email);
    await page.goto(`${wedding}/team`);
    await page.getByRole('button', { name: `Withdraw the invitation for ${guest.email}` }).click();
    await expect(page.getByText(guest.email)).toHaveCount(0);
    await p.goto(link);
    await expect(p.getByText('This invitation was withdrawn.')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  });
});
