import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { catchUpListings } from '@yayatoh/marketplace';
import { signLinkToken } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import {
  continueToPayment,
  expectAccessible,
  expectAccessibleBothModes,
  lastEmailedCode,
  ownClientIp,
  pickOption,
  signIn,
  WEDDING_OWNER,
} from './helpers.ts';
import {
  addGuests,
  addTicketType,
  createGala,
  priceAllAndPublish,
  publishEvent,
  quickPlan,
} from './seating-helpers.ts';

/**
 * Phase 6 hardening journeys, set C: one end-to-end journey per track, each chaining the track's
 * real UI flows across features, with a keyboard-only segment, axe in light and dark on the key
 * screens, and the main screen in Arabic (right to left). Fake providers only.
 *
 * - Seating: an organizer lays out a plan, prices it and puts seats on sale; a guest buys two seats
 *   by keyboard and the order names them; the organizer assigns a guest to a seat by keyboard and the
 *   public seat list takes that seat off sale; removing the guest frees it.
 * - AI: credits on the org; a tagline draft is only a preview (nothing saved) until accepted, and an
 *   agenda draft adds only the sessions picked; matchmaking suggests opted-in attendees to each
 *   other; an org with no credits left gets a clear state and a disabled button.
 * - Marketplace: publishing an event lists it (projection), search with facets finds it, its public
 *   page opens by keyboard, the tenant site shows it, and unpublishing removes it from search.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const TZ = 'America/Chicago';
const ORG = '/o/lakeside-events';

const project = () => test.info().project.name;
const tagOf = () =>
  `${Date.now()}${project().replace(/\D/g, '')}`
    .replace(/\d/g, (d) => 'abcdefghij'[Number(d)] ?? 'a')
    .slice(-14);
const chicagoDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));

test.afterAll(async () => {
  await closePools();
});

async function setCredits(request: APIRequestContext, org: string, balance: number) {
  const res = await request.post('/api/dev/ai-credits', { form: { org, balance: String(balance) } });
  expect(res.status()).toBe(200);
}

// ---------------------------------------------------------------------------------------------
// Seating
// ---------------------------------------------------------------------------------------------

test.describe('seating journey', () => {
  test('plan -> prices -> on sale -> seated checkout by keyboard -> assignment frees and takes seats', async ({
    page,
    browser,
  }) => {
    test.setTimeout(420_000);
    const stamp = `${Date.now()} ${project().split('-')[0]}`;
    const name = `Journey Gala ${stamp}`;
    const guest = `Ivy Journey ${stamp}`;
    await signIn(page);

    // 1. Layout: a plan of two tables of four, priced as one pass, put on sale, event published.
    const base = await createGala(page, name);
    const slug = base.split('/').pop() as string;
    await addTicketType(page, base, 'Table seat', '50', 100);
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
    await expectAccessibleBothModes(page);
    await priceAllAndPublish(page, base, 'Table seat');
    await publishEvent(page, base);

    // 2. A guest buys two seats; the list does everything, here by keyboard only.
    const ctx = await browser.newContext();
    await ownClientIp(ctx);
    const buyer = await ctx.newPage();
    await buyer.goto(`/events/${slug}`);
    await expect(buyer.getByRole('heading', { name: 'Choose your seats' })).toBeVisible();
    const table1 = buyer.getByRole('group', { name: 'Table 1' });
    await expect(table1.getByRole('checkbox')).toHaveCount(4, { timeout: 20_000 });
    await expectAccessibleBothModes(buyer);
    const labels: string[] = [];
    for (const i of [2, 3]) {
      const box = table1.getByRole('checkbox').nth(i);
      await box.focus();
      await buyer.keyboard.press('Space');
      await expect(box).toBeChecked();
      const id = await box.getAttribute('value');
      labels.push(
        ((await buyer.locator(`label:has(input[value="${id}"])`).innerText()).split(' (')[0] ?? '').trim(),
      );
    }
    await expect(buyer.getByRole('status').filter({ hasText: '2 seats selected' })).toBeVisible();
    const email = `guest.${Date.now()}.${project().split('-')[0]}@example.test`;
    await buyer.getByLabel('Full name').fill(`Buyer ${stamp}`);
    await buyer.getByLabel('Email for your tickets').fill(email);
    await continueToPayment(buyer, email);
    await expect(buyer.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await buyer.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(buyer).toHaveURL(/\/orders\//);
    await expect(buyer.getByRole('heading', { name: 'Your 2 tickets' })).toBeVisible();
    for (const l of labels) await expect(buyer.getByText(`Seat: ${l}`)).toBeVisible();
    await expectAccessibleBothModes(buyer);
    // Sold seats can no longer be chosen.
    await buyer.goto(`/events/${slug}`);
    await expect(table1.getByRole('checkbox').nth(2)).toBeDisabled();
    await expect(table1.getByRole('checkbox').nth(3)).toBeDisabled();

    // 3. Assignment: seat a guest at Table 2 (keyboard), the public list takes that seat off sale.
    await addGuests(page, base, [guest]);
    await page.goto(`${base}/seating/assign`);
    await expect(page.getByRole('heading', { name: 'Assign guests', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    const check = page.getByRole('checkbox', { name: guest });
    await check.focus();
    await page.keyboard.press('Space');
    await expect(check).toBeChecked();
    await pickOption(page.getByLabel('Table or row'), { label: 'Table 2 — 4 of 4 free' });
    await pickOption(page.getByLabel('Seat', { exact: true }), { label: 'Table 2 · 1' });
    const seatThem = page.getByRole('button', { name: 'Seat them' });
    await seatThem.focus();
    await page.keyboard.press('Enter');
    const feedback = page.locator('[aria-live="polite"]').getByRole('status');
    await expect(feedback).toHaveText('Seated 1 person at Table 2.');
    const t2 = page.getByRole('region', { name: 'Table 2', exact: true });
    await expect(t2).toContainText(guest);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Table 2', exact: true })).toContainText(guest);

    await buyer.reload();
    const table2 = buyer.getByRole('group', { name: 'Table 2' });
    await expect(table2.getByRole('checkbox').nth(0)).toBeDisabled();
    await expect(table2.getByRole('checkbox').nth(1)).toBeEnabled();

    // 4. Removing the guest frees the seat again.
    await page.getByRole('button', { name: `Remove ${guest} from Table 2` }).click();
    await expect(feedback).toHaveText(`${guest} no longer has a seat.`);
    await buyer.reload();
    await expect(table2.getByRole('checkbox').nth(0)).toBeEnabled();
    await ctx.close();

    // 5. Arabic: the assignment screen is right to left.
    await page.goto(`/ar${base}/seating/assign`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'توزيع الضيوف', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'أجلِسهم' })).toBeVisible();
    await expectAccessible(page);
  });
});

// ---------------------------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------------------------

const panel = (page: Page) => page.getByRole('region', { name: 'Draft with AI' });
const preview = (page: Page) => page.getByRole('region', { name: /^Draft preview/ });
const aiPreview = (page: Page) => page.getByRole('region', { name: 'AI draft' });

async function attendee(browser: Browser, network: string, name: string, interests: string): Promise<Page> {
  const emailOf = `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;
  const context = await browser.newContext();
  await ownClientIp(context);
  const p = await context.newPage();
  await p.goto(network);
  await p.getByLabel('Your email', { exact: true }).fill(emailOf);
  await p.getByRole('button', { name: 'Email me a code' }).click();
  await p.getByLabel('Verification code', { exact: true }).fill(await lastEmailedCode(p, emailOf));
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Create your networking profile' })).toBeVisible();
  await p.getByLabel('Name shown to others').fill(name);
  await p.getByLabel('Interests').fill(interests);
  await p.getByRole('checkbox', { name: /^Show my profile to other attendees/ }).check();
  await p.getByRole('button', { name: 'Join networking' }).click();
  await expect(p.getByRole('navigation', { name: 'Networking sections' })).toBeVisible();
  return p;
}

test.describe('AI journey', () => {
  test('credits -> drafts are previews -> agenda picks -> matchmaking -> out of credits', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(300_000);
    const s = `${Date.now()}${project().replace(/\D/g, '')}`;
    await setCredits(request, 'lakeside-events', 500);
    await signIn(page);

    // 1. A published event to draft for.
    await page.goto(`${ORG}/events/new`);
    await page.getByLabel('Event name', { exact: true }).fill(`AI Journey ${s}`);
    await pickOption(page.getByLabel('Event type'), 'conference');
    await pickOption(page.getByLabel('Time zone'), TZ);
    await page.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(40)}T09:00`);
    await page.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(40)}T18:00`);
    await page.getByLabel('Venue', { exact: true }).fill('Pier 9');
    await page.getByLabel('City', { exact: true }).fill('Chicago');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();

    // 2. Credits are shown; a draft is a preview that saves nothing until accepted.
    await page.goto(`${base}/content`);
    const ai = panel(page);
    await expect(ai.getByText('Nothing is published until you accept it.', { exact: false })).toBeVisible();
    const credits = ai.getByTestId('ai-credits');
    await expect(credits).toContainText('AI drafts left this month');
    const before = Number((await credits.textContent())?.match(/\d+/)?.[0]);
    await expectAccessibleBothModes(page);
    // Keyboard only: draft, then reject.
    await ai.getByRole('radio', { name: 'Tagline' }).focus();
    await page.keyboard.press('Space');
    await ai.getByRole('button', { name: 'Draft with AI' }).focus();
    await page.keyboard.press('Enter');
    const box = preview(page).getByLabel('Draft text');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(new RegExp(`^AI Journey ${s}: an unforgettable`));
    await expectAccessibleBothModes(page);
    await expect
      .poll(async () => Number((await credits.textContent())?.match(/\d+/)?.[0]))
      .toBeLessThan(before);
    await preview(page).getByRole('button', { name: 'Reject draft' }).focus();
    await page.keyboard.press('Enter');
    await expect(ai.getByText('Draft discarded. Nothing was saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('event-tagline')).toHaveText('No tagline yet.');
    // Draft again and accept: now it is saved.
    await ai.getByRole('button', { name: 'Draft with AI' }).click();
    await preview(page).getByRole('button', { name: 'Accept draft' }).click();
    await expect(ai.getByText('Tagline saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('event-tagline')).toContainText(`AI Journey ${s}`);

    // 3. Agenda draft: only the sessions kept are added.
    await page.goto(`${base}/sessions`);
    const agenda = page.getByRole('region', { name: 'Draft an agenda with AI' });
    await agenda.getByLabel('Topics or session ideas').fill('Welcome, Keynote, Workshops');
    await agenda.getByRole('button', { name: 'Draft with AI' }).click();
    const list = aiPreview(page).getByTestId('ai-agenda');
    await expect(list.getByRole('checkbox')).toHaveCount(3);
    await list.getByRole('checkbox', { name: /^Workshops/ }).focus();
    await page.keyboard.press('Space');
    await expect(list.getByRole('checkbox', { name: /^Workshops/ })).not.toBeChecked();
    await expectAccessibleBothModes(page);
    await aiPreview(page).getByRole('button', { name: 'Add 2 sessions' }).click();
    await expect(agenda.getByText('2 sessions added to the agenda.')).toBeVisible();
    await page.reload();
    const sessions = page.getByRole('region', { name: 'Agenda' });
    await expect(sessions.getByText('Keynote', { exact: true })).toBeVisible();
    await expect(sessions.getByText('Workshops', { exact: true })).toHaveCount(0);

    // 4. Matchmaking: turn networking on, two attendees opt in, suggestions are prepared.
    const slug = base.split('/').pop() ?? '';
    const network = `/events/${slug}/network`;
    await page.goto(`${base}/networking`);
    await page.getByRole('button', { name: 'Turn on networking' }).click();
    await expect(page.getByText('People in the directory', { exact: true })).toBeVisible();
    const [ana, ben] = [`Ana Match ${s}`, `Ben Match ${s}`];
    await addGuests(page, base, [ana, ben]);
    const a = await attendee(browser, network, ana, 'Data, AI, Analytics');
    const b = await attendee(browser, network, ben, 'AI, Data science');
    await page.goto(`${base}/networking`);
    const card = page.getByRole('region', { name: 'Match suggestions' });
    await expect(card.getByTestId('matchmaking-status')).toHaveText(
      'Suggestions ready for 0 of 2 listed people.',
    );
    await expectAccessibleBothModes(page);
    await card.getByRole('button', { name: /^Update suggestions/ }).focus();
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('matchmaking-status')).toHaveText(
      'Suggestions ready for 2 of 2 listed people.',
    );
    await a.reload();
    const suggested = a.getByRole('list', { name: 'Suggested matches' });
    await expect(suggested.getByRole('listitem').first()).toContainText(ben);
    await expect(suggested.getByRole('listitem').first()).toContainText('You both like: AI');
    await expectAccessibleBothModes(a);
    await a.close();
    await b.close();

    // 5. Arabic, right to left: the AI agenda panel and the attendee suggestions.
    await page.goto(`/ar${base}/sessions`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'صياغة برنامج بالذكاء الاصطناعي' })).toBeVisible();
    await expectAccessible(page);

    // 6. An org with no credits left: a clear state, and the draft button is off.
    await setCredits(request, 'rosewood-weddings', 0);
    const ctx = await browser.newContext();
    const owner = await ctx.newPage();
    await signIn(owner, WEDDING_OWNER);
    await owner.goto('/o/rosewood-weddings/content/new?kind=page');
    const none = owner.getByRole('region', { name: 'Draft with AI' });
    await expect(none.getByText("You're out of AI credits")).toBeVisible();
    await expect(none.getByRole('button', { name: 'Draft with AI' })).toBeDisabled();
    await expectAccessibleBothModes(owner);
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------------------------

/** No worker runs under e2e: feed the projector, ask the web app to run the search indexer. */
async function project_(page: Page, orgSlug: string) {
  const org = await resolveOrgSlug(orgSlug);
  if (!org) throw new Error(`no org ${orgSlug}`);
  await catchUpListings(org.orgId);
  const rev = await page.request.post('/api/internal/revalidate', {
    data: { token: signLinkToken('cache.revalidate', org.orgId) },
  });
  expect(rev.status()).toBe(200);
  const run = await page.request.post('/api/dev/search/run', { form: { org: orgSlug } });
  expect(run.status()).toBe(200);
}

test.describe('marketplace journey', () => {
  test('publish -> projection -> search with facets -> public page by keyboard -> unpublish', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tag = `jm${tagOf()}`;
    const name = `Pleyel Quartet ${tag}`;
    // Harbor Arts is enrolled and listed; its owner signs in directly (a fresh org's owner would first
    // have to set up two-step verification). Unique names keep every project and rerun apart.
    const orgSlug = 'harbor-arts';
    await signIn(page, 'lee@harbor.test');
    const tenant = `http://${orgSlug}.yayatoh.events:${PORT}`;

    // 1. The organizer creates and publishes an event.
    await page.goto(`/o/${orgSlug}/events/new`);
    await page.getByLabel('Event name', { exact: true }).fill(name);
    await pickOption(page.getByLabel('Event type'), 'concert');
    await pickOption(page.getByLabel('Time zone'), 'Europe/Paris');
    await page.getByLabel('Starts', { exact: true }).fill('2029-05-05T19:00');
    await page.getByLabel('Ends', { exact: true }).fill('2029-05-05T22:00');
    await page.getByLabel('City').fill(`Metz ${tag}`);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Draft ·')).toBeVisible();
    const dashboard = page.url();
    const slug = dashboard.split('/').pop() ?? '';
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await project_(page, orgSlug);

    // 2. The marketplace list and the search find it; facets narrow; the URL keeps them.
    await page.goto(`/events?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await page.goto(`${MARKET}/search?q=${tag}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Search events' })).toBeVisible();
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link', { name })).toBeVisible();
    await expect(page.getByText('1 event', { exact: true })).toBeVisible();
    await pickOption(page.getByLabel('City'), { label: new RegExp(`Metz ${tag}`) });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/city=/);
    await expect(results.getByRole('link', { name })).toBeVisible();
    await page.reload();
    await expect(results.getByRole('link', { name })).toBeVisible();
    await expectAccessibleBothModes(page);

    // 3. Keyboard only: a fresh search, then open the result.
    await page.goto(`${MARKET}/search`);
    const box = page.getByRole('searchbox', { name: 'Search by name, place or organizer' });
    await box.focus();
    await page.keyboard.type(`quartet ${tag}`);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`q=quartet\\+${tag}`));
    const link = results.getByRole('link', { name });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/events/${slug}$`));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expectAccessibleBothModes(page);

    // 4. The organizer's tenant site shows it too.
    await page.goto(`${tenant}/events/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

    // 5. Unpublishing removes it from the list and from search.
    await page.goto(dashboard);
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Draft ·')).toBeVisible();
    await project_(page, orgSlug);
    await page.goto(`${MARKET}/search?q=${tag}`);
    await expect(page.getByText('No events match these filters')).toBeVisible();
    await page.goto(`/events?q=${encodeURIComponent(name)}`);
    await expect(page.getByText('No events match these filters')).toBeVisible();
    await expectAccessibleBothModes(page);

    // 6. Arabic search (last: the language sticks), right to left.
    await page.goto(`${MARKET}/ar/search`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'ابحث عن الفعاليات' })).toBeVisible();
    await expectAccessible(page);
  });
});
