import { type Browser, expect, type Page, test } from '@playwright/test';
import { AggregateRatingSchema } from '../src/lib/seo/jsonld.ts';
import { continueToPayment, expectAccessible, pickOption, signIn } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

/** A wall-clock time in Chicago, `offsetMin` minutes from now (datetime-local format). */
function chicago(offsetMin: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetMin * 60_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

/** A published event with a free pass, created through the console; returns its paths. */
async function createEvent(page: Page, name: string, startMin: number, endMin: number) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(startMin));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(endMin));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Entry');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Entry' })).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

/** A guest buys one free pass; returns their order page (a fresh browser context each). */
async function buy(browser: Browser, slug: string, name: string): Promise<Page> {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await pickOption(guest.getByLabel('Quantity — Entry'), '1');
  await guest.getByLabel('Full name').fill(name);
  const email = `${name.replace(/\W+/g, '.').toLowerCase()}@example.test`;
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  return guest;
}

/** Rate by keyboard: focus the first star option, arrow to the rating, type, submit. */
async function review(guest: Page, rating: number, text: string) {
  const section = guest.getByRole('region', { name: 'Review this event' });
  await section.getByRole('radio', { name: '1 star', exact: true }).focus();
  for (let i = 1; i < rating; i++) await guest.keyboard.press('ArrowRight');
  await expect(section.getByRole('radio', { name: `${rating} stars`, exact: true })).toBeChecked();
  await section.getByLabel('Your review (optional)').fill(text);
  await section.getByRole('button', { name: 'Post review' }).focus();
  await guest.keyboard.press('Enter');
  await expect(section.getByText('Your review', { exact: true })).toBeVisible();
}

async function eventLd(page: Page, slug: string) {
  await page.goto(`/events/${slug}`);
  return JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}') as {
    aggregateRating?: unknown;
  };
}

test.describe('event reviews (M1.4g)', () => {
  test('a holder of a future event is told when reviews open; no form', async ({ page, browser }) => {
    const s = stamp();
    await signIn(page);
    const { slug } = await createEvent(page, `Future gala ${s}`, 60 * 24 * 3, 60 * 24 * 3 + 180);
    const guest = await buy(browser, slug, `Future Guest ${s}`);
    const section = guest.getByRole('region', { name: 'Review this event' });
    await expect(section.getByText(/You can review this event once it ends/)).toBeVisible();
    await expect(section.getByRole('button', { name: 'Post review' })).toHaveCount(0);
    await expectAccessible(guest);
  });

  test('holders of a past event review once each; the page shows the aggregate and JSON-LD from 3 reviews; moderation hides one', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Past social ${s}`, -240, -60);

    // No reviews yet: the organizer sees the empty state, the public page no section.
    await page.goto(`${base}/reviews`);
    await expect(page.getByText('No reviews yet')).toBeVisible();
    await expectAccessible(page);

    const maria = await buy(browser, slug, `Maria Lopez${s}`);
    const section = maria.getByRole('region', { name: 'Review this event' });
    await expect(section.getByText(/How was it\? Reviews are open until/)).toBeVisible();
    await expectAccessible(maria);
    // A second tab of the same order page (a stale form for the duplicate check).
    const again = await maria.context().newPage();
    await again.goto(maria.url());

    // Validation: no rating chosen.
    await section.getByRole('button', { name: 'Post review' }).click();
    await expect(section.getByText('Choose a rating from 1 to 5.')).toBeVisible();
    await expectAccessible(maria);
    await review(maria, 4, 'Great music, long queue.');
    await expect(section.getByRole('img', { name: 'You rated it 4 out of 5' })).toBeVisible();
    await maria.reload();
    await expect(section.getByText('Great music, long queue.')).toBeVisible();
    await expect(section.getByRole('button', { name: 'Post review' })).toHaveCount(0);
    await expectAccessible(maria);

    // The duplicate from the stale tab is refused.
    await again.getByRole('radio', { name: '5 stars', exact: true }).check();
    await again.getByRole('button', { name: 'Post review' }).click();
    await expect(
      again.getByRole('alert').filter({ hasText: 'You have already reviewed this event.' }),
    ).toBeVisible();

    // Two reviews: shown publicly, but no aggregateRating in JSON-LD yet.
    const ben = await buy(browser, slug, `Ben Okafor${s}`);
    await review(ben, 5, 'Loved it.');
    const pub = await (await browser.newContext()).newPage();
    expect((await eventLd(pub, slug)).aggregateRating).toBeUndefined();
    const reviews = pub.getByRole('region', { name: 'Reviews' });
    await expect(reviews.getByText('4.5 out of 5 · 2 reviews')).toBeVisible();

    const cara = await buy(browser, slug, `Cara Ng${s}`);
    await review(cara, 3, 'Fine.');
    const ld = await eventLd(pub, slug);
    expect(AggregateRatingSchema.parse(ld.aggregateRating)).toMatchObject({
      ratingValue: '4.0',
      reviewCount: 3,
    });
    await expect(reviews.getByText('4 out of 5 · 3 reviews')).toBeVisible();
    // "First L." only; no emails in the page.
    await expect(reviews.getByText(/^Maria L\. · /)).toBeVisible();
    expect(await pub.content()).not.toContain('@example.test');
    await expectAccessible(pub);

    // A visitor reports Cara's review.
    const caraItem = reviews.getByRole('listitem').filter({ hasText: 'Fine.' });
    await caraItem.getByRole('button', { name: /^Report/ }).click();
    await expect(caraItem.getByLabel('Why are you reporting it?')).toBeFocused();
    await pickOption(caraItem.getByLabel('Why are you reporting it?'), 'off_topic');
    await caraItem.getByRole('button', { name: 'Send report' }).click();
    await expect(caraItem.getByText('Thanks. The organizer will look at it.')).toBeVisible();
    await expectAccessible(pub);

    // The organizer: reported filter, hide with a reason (required), public aggregate follows.
    await page.goto(`${base}/reviews?filter=reported`);
    const card = page.getByRole('article', { name: /^Review by Cara N\./ });
    await expect(card.getByText('1 open report')).toBeVisible();
    await expect(card.getByText('Not about this event · open')).toBeVisible();
    await expectAccessible(page);
    const item = page.getByRole('listitem').filter({ has: card });
    await item.getByRole('button', { name: 'Hide review' }).click();
    await expect(item.getByText('Give a reason (3 to 300 characters).')).toBeVisible();
    await item.getByLabel('Reason for hiding', { exact: true }).fill('Off-topic complaint');
    await item.getByRole('button', { name: 'Hide review' }).click();
    // Handled: its report is no longer open, so it leaves the "Reported" list.
    await expect(card).toHaveCount(0);
    await page.goto(`${base}/reviews?filter=hidden`);
    await expect(page.getByText('Hidden: Off-topic complaint')).toBeVisible();
    await expect(page.getByText('Not about this event · handled')).toBeVisible();
    await expectAccessible(page);
    const ldAfter = await eventLd(pub, slug);
    expect(ldAfter.aggregateRating).toBeUndefined();
    await expect(
      pub.getByRole('region', { name: 'Reviews' }).getByText('4.5 out of 5 · 2 reviews'),
    ).toBeVisible();
    await expect(pub.getByText('Fine.')).toHaveCount(0);
    // Cara's own order page says it was hidden.
    await cara.reload();
    await expect(cara.getByText('The organizer has hidden your review from the event page.')).toBeVisible();

    // Show it again: back in the public aggregate.
    await page.getByLabel('Reason for showing again', { exact: true }).fill('Reviewed again, fine');
    await page.getByRole('button', { name: 'Show review' }).click();
    await expect(page.getByText('No reviews here')).toBeVisible();
    await page.goto(`${base}/reviews`);
    await expect(page.getByText('3', { exact: true })).toBeVisible();
    await pub.goto(`/events/${slug}`);
    await expect(pub.getByText('4 out of 5 · 3 reviews')).toBeVisible();
  });

  test('a viewer reads reviews but has no moderation controls and is refused on a stale form', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Viewer reviews ${s}`, -240, -60);
    const guest = await buy(browser, slug, `Vic Tor${s}`);
    await review(guest, 2, 'Too loud.');

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/reviews`);
    await expect(viewer.getByText('You can read reviews but not moderate them.')).toBeVisible();
    await expect(viewer.getByText('Too loud.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Hide review' })).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's open moderation form, submitted after switching to the viewer: refused.
    await page.goto(`${base}/reviews`);
    await signIn(page, VIEWER);
    await page.getByLabel('Reason for hiding', { exact: true }).fill('Trying anyway');
    await page.getByRole('button', { name: 'Hide review' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await viewer.goto(`/events/${slug}`);
    await expect(viewer.getByText('Too loud.')).toBeVisible();
  });

  test('Arabic: the order page review form and the moderation page render right-to-left', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `RTL reviews ${s}`, -240, -60);
    const guest = await buy(browser, slug, `Rami Haddad${s}`);
    await guest.goto(guest.url().replace(/\/orders\//, '/ar/orders/'));
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'قيّم هذه الفعالية' })).toBeVisible();
    await expectAccessible(guest);
    await page.goto(`/ar${base}/reviews`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('التقييمات');
    await expectAccessible(page);
  });
});
