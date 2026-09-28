/**
 * Product screenshots for the client preview (not a test; kept out of the e2e suites).
 *
 * Needs what the e2e suites need: a migrated, seeded database (plus `migrate:legacy:demo` and the
 * staff persona), YAYATOH_DEV_AUTH=1, DEV_PERSONA_PASSWORD, and the built web (:3100) and admin
 * (:3101) apps running with `next start`, and the worker (`pnpm --filter @yayatoh/worker start`, which
 * keeps the public listings current; it needs NEXT_PUBLIC_APP_ORIGIN). It first creates realistic data through the real UI
 * (orders, a seated gala, an event happening today, a finished event with survey answers), then
 * captures every screen into `docs/screenshots/<month>/` with a `manifest.json`.
 *
 *   node tools/screenshots/capture.ts            # everything
 *   node tools/screenshots/capture.ts 05 06      # only these shots (setup still runs, idempotently)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Playwright lives in the web app's dev dependencies.
const require = createRequire(fileURLToPath(new URL('../../apps/web/package.json', import.meta.url)));
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');
type Browser = import('@playwright/test').Browser;
type BrowserContext = import('@playwright/test').BrowserContext;
type Page = import('@playwright/test').Page;

const WEB = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const ADMIN = `http://localhost:${process.env.E2E_ADMIN_PORT ?? 3101}`;
const PORT = new URL(WEB).port;
const MARKET = `http://yayatoh.localhost:${PORT}`;
const LAKESIDE_SITE = `http://lakeside-events.yayatoh.events:${PORT}`;
const OUT_DIR = fileURLToPath(
  new URL(`../../docs/screenshots/${process.env.SHOTS_MONTH ?? '2026-09'}/`, import.meta.url),
);
const OWNER = 'pani@lakeside.test';
const STAFF = 'omar@yayatoh.test';
const ORG = '/o/lakeside-events';
const SUMMIT = `${ORG}/e/midwest-leadership-summit-2027`;
const OPEN_HOUSE = `${ORG}/e/lakeside-open-house`;
const MAX_BYTES = 1.5 * 1024 * 1024;

const only = new Set(process.argv.slice(2));
const want = (id: string) => only.size === 0 || only.has(id);

interface Shot {
  file: string;
  title: string;
  caption: string;
  viewport: string;
  path: string;
}
const shots: Shot[] = [];
const skipped: { id: string; title: string; reason: string }[] = [];

function log(...a: unknown[]) {
  process.stdout.write(`${[new Date().toISOString().slice(11, 19), ...a].join(' ')}\n`);
}

// ————————————————————————————————————————————————————————— helpers

/** `YYYY-MM-DDTHH:mm` wall-clock time in Chicago, `offsetH` hours from now (datetime-local). */
function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const emailOf = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;

async function newContext(browser: Browser, width = 1440, height = 900, extra: object = {}) {
  return browser.newContext({ viewport: { width, height }, baseURL: WEB, ...extra });
}

async function signIn(page: Page, email = OWNER) {
  const res = await page.request.post(`${WEB}/api/dev/login`, {
    form: { email, locale: 'en' },
    maxRedirects: 0,
  });
  if (res.status() !== 303) throw new Error(`dev login for ${email}: ${res.status()}`);
}

/** The page answers 200 (an event exists), without failing on 404. */
async function exists(page: Page, path: string) {
  const res = await page.goto(path);
  return res?.status() === 200;
}

async function lastEmailedCode(page: Page, email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await page.request.get(`${WEB}/api/dev/last-code?to=${encodeURIComponent(email)}`);
    const { code } = (await res.json()) as { code: string | null };
    if (code && /^\d{6}$/.test(code)) return code;
    await page.waitForTimeout(250);
  }
  throw new Error(`no emailed code for ${email}`);
}

async function drain(page: Page, scheduled = false) {
  const form: Record<string, string> = { org: 'lakeside-events' };
  if (scheduled) form.scheduled = '1';
  await page.request.post(`${WEB}/api/dev/outbox/drain`, { form });
}

/** Waits until the page is visually settled: network quiet, web fonts and images loaded. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true })),
      ),
    );
  });
  // No focus rings from the last field filled; charts and entrance transitions finish.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(600);
}

/** Scrolls so that the locator's first match sits `offset` px below the top of the viewport. */
async function scrollToTop(locator: import('@playwright/test').Locator, offset = 24) {
  await locator.first().waitFor();
  await locator.first().evaluate((el, off) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
  }, offset);
}

/**
 * Saves the first screen (and, when the page is taller than the viewport, a full-page version).
 * Falls back to JPEG only if a PNG would exceed the size limit.
 */
async function shoot(
  page: Page,
  id: string,
  slug: string,
  title: string,
  caption: string,
  opts: { full?: boolean; path?: string } = {},
) {
  await settle(page);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const viewport = `${vp.width}×${vp.height}`;
  const path = opts.path ?? new URL(page.url()).pathname + new URL(page.url()).search;
  const host = new URL(page.url()).host;
  const shownPath = page.url().startsWith(ADMIN)
    ? `admin console ${path}`
    : host.startsWith('localhost')
      ? path
      : `${host.replace(/:\d+$/, '')}${path}`;
  await save(page, `${id}-${slug}`, { fullPage: false }, { title, caption, viewport, path: shownPath });
  if (opts.full !== false) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > vp.height + 80) {
      await save(
        page,
        `${id}-${slug}-full`,
        { fullPage: true },
        { title: `${title} (full page)`, caption, viewport: `${vp.width}×full`, path: shownPath },
      );
    }
  }
}

async function save(page: Page, name: string, opts: { fullPage: boolean }, meta: Omit<Shot, 'file'>) {
  let file = `${name}.png`;
  let buf = await page.screenshot({ fullPage: opts.fullPage, animations: 'disabled', caret: 'hide' });
  if (buf.length > MAX_BYTES) {
    for (const quality of [85, 75, 65]) {
      file = `${name}.jpg`;
      buf = await page.screenshot({ fullPage: opts.fullPage, type: 'jpeg', quality, animations: 'disabled' });
      if (buf.length <= MAX_BYTES) break;
    }
  }
  writeFileSync(`${OUT_DIR}/${file}`, buf);
  shots.push({ file, ...meta });
  log('saved', file, `${Math.round(buf.length / 1024)} KB`);
}

/** Runs one shot; a broken screen is recorded as skipped instead of stopping the run. */
async function step(id: string, title: string, fn: () => Promise<undefined | string>) {
  if (!want(id)) return;
  log('shot', id, title);
  try {
    const reason = await fn();
    if (typeof reason === 'string') skipped.push({ id, title, reason });
  } catch (err) {
    const reason = (err as Error).message.split('\n')[0] ?? 'failed';
    log('  skipped:', reason);
    skipped.push({ id, title, reason: `Could not capture: ${reason}` });
  }
}

// ————————————————————————————————————————————————————————— data setup (through the real UI)

async function createEvent(
  page: Page,
  e: { name: string; type?: string; starts: string; ends: string; venue?: string; city?: string },
) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(e.name);
  if (e.type) await page.getByLabel('Event type').selectOption(e.type);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(e.starts);
  await page.getByLabel('Ends', { exact: true }).fill(e.ends);
  if (e.venue) await page.getByLabel('Venue').fill(e.venue);
  if (e.city) await page.getByLabel('City').fill(e.city);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

async function publish(page: Page, base: string) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByText('Published ·').first().waitFor();
}

async function addTicketTypes(page: Page, base: string, types: readonly [string, string, number][]) {
  await page.goto(`${base}/tickets-orders`);
  for (const [name, price, qty] of types) {
    if ((await page.getByRole('row').filter({ hasText: name }).count()) > 0) continue;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Price (USD)').fill(price);
    await page.getByLabel('Quantity available').fill(String(qty));
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await page.getByRole('row').filter({ hasText: name }).first().waitFor();
  }
}

/**
 * A guest buys on the public page: picks quantities (or seats), confirms the emailed code and pays
 * on the test checkout. Returns the order page. `beforeVerify` sees the email-code step.
 */
async function buy(
  browser: Browser,
  slug: string,
  who: string,
  pick: { qty?: Record<string, number>; seats?: number; row?: string },
  hooks: { beforeVerify?: (p: Page) => Promise<void>; beforePay?: (p: Page) => Promise<void> } = {},
): Promise<{ page: Page; context: BrowserContext; url: string }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(`/events/${slug}`);
  for (const [type, n] of Object.entries(pick.qty ?? {}))
    await page.getByLabel(`Quantity — ${type}`, { exact: true }).selectOption(String(n));
  if (pick.seats) {
    const group = pick.row ? page.getByRole('group', { name: pick.row, exact: true }) : page;
    const boxes = group.locator('input[name="seat"]:not([disabled])');
    await boxes.first().waitFor();
    for (let i = 0; i < pick.seats; i++) await boxes.nth(i).check();
  }
  const email = emailOf(who);
  await page.getByLabel('Full name').fill(who);
  await page.getByLabel('Email for your tickets').fill(email);
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  const field = page.getByLabel('Verification code', { exact: true });
  await field.waitFor();
  if (hooks.beforeVerify) await hooks.beforeVerify(page);
  await field.fill(await lastEmailedCode(page, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.waitForURL(/\/(orders|checkout\/fake)/);
  if (page.url().includes('/checkout/fake')) {
    if (hooks.beforePay) await hooks.beforePay(page);
    await page.getByRole('button', { name: /^Pay/ }).click();
    await page.waitForURL(/\/orders\//);
  }
  await page
    .getByText('Paid', { exact: true })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  return { page, context, url: new URL(page.url()).pathname };
}

const OPEN_HOUSE_BUYERS: [string, Record<string, number>][] = [
  ['Amara Okafor', { 'General admission': 2 }],
  ['Daniel Kim', { 'General admission': 1, 'VIP reception': 1 }],
  ['Sofia Martinez', { 'Family pass': 1 }],
  ['Kwame Mensah', { 'General admission': 3 }],
  ['Hannah Weiss', { 'VIP reception': 2 }],
  ['Lucas Moreau', { 'General admission': 2 }],
  ['Priya Raman', { 'Family pass': 1, 'General admission': 1 }],
  ['Marcus Johnson', { 'VIP reception': 1 }],
];

const state: {
  galaBase?: string;
  socialBase?: string;
  supperBase?: string;
  socialCodes: string[];
} = { socialCodes: [] };

async function setup(browser: Browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await signIn(page);

  // 0. The organization's brand colour (public pages, checkout button).
  await page.goto(`${ORG}/settings`);
  const brand = page.locator('form').filter({ has: page.locator('#brand-color') });
  if ((await page.locator('#brand-color').inputValue()) === '') {
    await page.locator('#brand-color').fill('#0f766e');
    await brand.getByRole('button', { name: 'Save' }).click();
    await page.waitForLoadState('networkidle');
  }

  // 1. Lakeside Open House: ticket types and a handful of real orders.
  await addTicketTypes(page, OPEN_HOUSE, [
    ['General admission', '25', 300],
    ['VIP reception', '75', 40],
    ['Family pass', '60', 50],
  ]);
  await page.goto(`${OPEN_HOUSE}/tickets-orders`);
  const hasOrders = (await page.getByText('No orders yet').count()) === 0;
  if (!hasOrders) {
    for (const [who, qty] of OPEN_HOUSE_BUYERS) {
      log('  order', who);
      const o = await buy(browser, 'lakeside-open-house', who, { qty });
      await o.context.close();
    }
  }

  // 2. A seated gala: round tables around a stage, on sale.
  const galaName = 'Lakeside Charity Gala 2027';
  state.galaBase = `${ORG}/e/lakeside-charity-gala-2027`;
  if (!(await exists(page, state.galaBase))) {
    log('  gala');
    state.galaBase = await createEvent(page, {
      name: galaName,
      type: 'gala',
      starts: '2027-12-04T18:00',
      ends: '2027-12-04T23:30',
      venue: 'Harbor Hall',
      city: 'Chicago',
    });
    await addTicketTypes(page, state.galaBase, [['Dinner seat', '150', 500]]);
    await page.goto(`${state.galaBase}/seating`);
    await page.getByLabel('Rows').fill('2');
    await page.getByLabel('Seats per row').fill('12');
    await page.getByLabel('Round tables').fill('12');
    await page.getByLabel('Seats per table').fill('8');
    await page.getByRole('button', { name: 'Create plan' }).click();
    await page.getByRole('application', { name: 'Seating plan' }).waitFor();
    await page.goto(`${state.galaBase}/seating`);
    const prices = page.getByRole('region', { name: 'Prices' });
    const boxes = prices.getByRole('checkbox');
    await boxes.first().waitFor();
    await boxes.evaluateAll((els) => {
      for (const el of els) if (!(el as HTMLInputElement).checked) (el as HTMLInputElement).click();
    });
    await prices.getByLabel('Sells as').selectOption({ label: 'Dinner seat' });
    await prices.getByRole('button', { name: 'Set price' }).click();
    await prices.getByText('Prices updated.').waitFor();
    await page.getByRole('button', { name: 'Put seats on sale' }).click();
    await page.getByText('On sale', { exact: true }).first().waitFor();
    await publish(page, state.galaBase);
    for (const [who, n] of [
      ['Elena Petrova', 4],
      ['Noah Fischer', 2],
      ['Aisha Bello', 6],
    ] as const) {
      log('  gala order', who);
      const o = await buy(browser, 'lakeside-charity-gala-2027', who, { seats: n });
      await o.context.close();
    }
  }

  // 3. An event happening today (check-in open), with arrivals already scanned at the door.
  const socialName = 'Lakeside Autumn Social';
  state.socialBase = `${ORG}/e/lakeside-autumn-social`;
  if (!(await exists(page, state.socialBase))) {
    log('  social');
    state.socialBase = await createEvent(page, {
      name: socialName,
      type: 'community',
      starts: chicago(-1),
      ends: chicago(4),
      venue: 'Lakeside Pavilion',
      city: 'Chicago',
    });
    await publish(page, state.socialBase);
    await addTicketTypes(page, state.socialBase, [
      ['Entry', '15', 150],
      ['Entry + drinks', '35', 60],
    ]);
    for (const [who, qty] of [
      ['Grace Liu', { Entry: 2 }],
      ['Mateo Rossi', { 'Entry + drinks': 2 }],
      ['Chloe Dubois', { Entry: 1 }],
      ['Samuel Adeyemi', { 'Entry + drinks': 1 }],
      ['Yuki Tanaka', { Entry: 3 }],
    ] as const) {
      log('  social order', who);
      const o = await buy(browser, 'lakeside-autumn-social', who, { qty: { ...qty } });
      const codes = (await o.page.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
      state.socialCodes.push(...codes);
      await o.context.close();
    }
    // Some guests are already in.
    await page.goto(`${state.socialBase}/onsite`);
    for (const code of state.socialCodes.slice(0, 5)) {
      const field = page.getByLabel('Ticket code');
      await field.fill(code);
      await field.press('Enter');
      await page
        .getByRole('status')
        .filter({ has: page.locator('[data-result]') })
        .waitFor();
      await page.waitForTimeout(400);
    }
    for (const name of ['North gate', 'Terrace bar']) {
      await page.getByLabel('Device name').fill(name);
      await page.getByRole('button', { name: 'Add device' }).click();
      await page.getByText(`Enter this key on ${name}. It is shown only once.`).waitFor();
      await page.goto(`${state.socialBase}/onsite`);
    }
  }

  // 4. A finished event with a post-event survey and answers (NPS).
  const supperName = 'Spring Supper Club';
  state.supperBase = `${ORG}/e/spring-supper-club`;
  if (!(await exists(page, state.supperBase))) {
    log('  supper');
    state.supperBase = await createEvent(page, {
      name: supperName,
      type: 'community',
      starts: '2026-03-14T18:30',
      ends: '2026-03-14T22:00',
      venue: 'The Boathouse',
      city: 'Chicago',
    });
    await publish(page, state.supperBase).catch(() => log('  (a finished event stays a draft)'));
    const guests = [
      'Olivia Brooks',
      'Ethan Clarke',
      'Zara Ahmed',
      'Liam O’Connor',
      'Mia Novak',
      'Ravi Patel',
      'Isabel Costa',
      'Jonas Berg',
      'Fatima Diallo',
      'Ben Carter',
    ];
    await page.goto(`${state.supperBase}/attendees`);
    await page
      .getByText(/^Add (attendee|guest|member)/i)
      .first()
      .click();
    for (const name of guests) {
      await page.getByLabel('Full name').fill(name);
      await page.getByLabel('Email', { exact: true }).fill(emailOf(name));
      await page.getByRole('button', { name: 'Add to the list' }).click();
      await page.getByRole('row').filter({ hasText: name }).first().waitFor();
    }
    await page.goto(`${state.supperBase}/marketing/surveys`);
    await page.getByRole('button', { name: 'Create the post-event survey' }).click();
    await page.waitForURL(/\/marketing\/surveys\/[0-9a-f-]{36}$/);
    const surveyUrl = new URL(page.url()).pathname;
    const add = page.getByRole('form', { name: 'Add a question' });
    await add.getByLabel('Question', { exact: true }).fill('What did you enjoy most?');
    await add.getByLabel('Type', { exact: true }).selectOption({ label: 'One choice' });
    await add.getByLabel('Options', { exact: true }).fill('The food\nThe music\nMeeting people\nThe venue');
    await add.getByRole('button', { name: 'Add question' }).click();
    await add.getByText('Question added.').waitFor();
    const send = page.getByRole('form', { name: 'Send' });
    await send.getByLabel('Everyone attending').check();
    await send.getByLabel('Links work for (days)').fill('30');
    await send.getByRole('button', { name: 'Send survey' }).click();
    await send.getByText(/Sent to \d+ people\./).waitFor();
    await drain(page);
    const title = `How was ${supperName}?`;
    const answers: [number, number, string, string][] = [
      [10, 5, 'The food', 'Nothing — it was perfect.'],
      [9, 5, 'Meeting people', ''],
      [10, 5, 'The music', 'Keep the live trio!'],
      [8, 4, 'The food', 'A little more space between tables.'],
      [9, 4, 'The venue', ''],
      [6, 3, 'The food', 'Service was slow at the start.'],
      [10, 5, 'Meeting people', 'More events like this, please.'],
      [7, 4, 'The music', ''],
    ];
    for (const [i, [score, stars, best, better]] of answers.entries()) {
      const email = emailOf(guests[i] as string);
      let link = '';
      for (let t = 0; t < 40 && !link; t++) {
        const res = await page.request.get(`${WEB}/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        const mail = ((await res.json()) as { subject: string; html: string }[]).find(
          (m) => m.subject === title,
        );
        link = /href="(https?:\/\/[^"]+\/survey\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
        if (!link) await page.waitForTimeout(250);
      }
      if (!link) throw new Error(`no survey link for ${email}`);
      const g = await (await newContext(browser)).newPage();
      await g.goto(new URL(link).pathname);
      await g
        .getByRole('group', {
          name: `How likely are you to recommend ${supperName} to a friend or colleague?`,
        })
        .getByRole('radio', { name: String(score), exact: true })
        .check({ force: true });
      await g
        .getByRole('group', { name: 'How would you rate it overall? (optional)' })
        .getByRole('radio', { name: `${stars} of 5` })
        .check({ force: true });
      await g
        .getByRole('group', { name: 'What did you enjoy most? (optional)' })
        .getByLabel(best)
        .check({ force: true });
      if (better) await g.getByLabel('What could we do better? (optional)').fill(better);
      await g.getByRole('button', { name: 'Send my answers' }).click();
      await g.getByRole('heading', { name: 'Thank you!' }).waitFor();
      await g.context().close();
    }
    await page.goto(surveyUrl);
  }

  // Payout release for the open house (as of a week after it ends), so settlements show.
  await page.request.post(`${WEB}/api/dev/payments/settle`, {
    form: { org: 'lakeside-events', now: '2027-06-21T12:00:00Z' },
  });
  await drain(page);
  await ctx.close();
}

// ————————————————————————————————————————————————————————— the shots

async function organizerShots(browser: Browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await signIn(page);
  const galaBase = state.galaBase ?? `${ORG}/e/lakeside-charity-gala-2027`;
  const socialBase = state.socialBase ?? `${ORG}/e/lakeside-autumn-social`;
  const supperBase = state.supperBase ?? `${ORG}/e/spring-supper-club`;

  await step('01', 'Organizer dashboard', async () => {
    await page.goto(ORG);
    await shoot(
      page,
      '01',
      'dashboard',
      'Organizer dashboard',
      'The home screen for Lakeside Events: a setup checklist, sales for the period, and every event at a glance. An organizer sees what needs doing next the moment they sign in.',
    );
  });

  await step('02', 'Events list', async () => {
    await page.goto(ORG);
    await scrollToTop(page.getByRole('heading', { name: 'Sales', exact: true }));
    await settle(page);
    await save(
      page,
      '02-events-list',
      { fullPage: false },
      {
        title: 'Events list',
        caption:
          'All of the organization’s events with their status and countdown, filterable by category and tag. Each card opens the event’s own workspace.',
        viewport: '1440×900',
        path: ORG,
      },
    );
  });

  await step('03', 'Event overview with readiness checklist', async () => {
    await page.goto(SUMMIT);
    await shoot(
      page,
      '03',
      'event-overview',
      'Event overview',
      'The Midwest Leadership Summit workspace: registrations against goal, gross sales, tickets distributed and people seated, the sales curve compared with past years, items that need attention and the event readiness checklist.',
    );
  });

  await step('04', 'Event creation wizard', async () => {
    await page.goto(`${ORG}/events/new/guided`);
    await page.getByLabel('Event name', { exact: true }).fill('Lakeside Winter Market');
    await page.getByLabel('Tagline (optional)').fill('Local makers, hot cider and live music by the lake.');
    await page.getByLabel('Event type').selectOption('community');
    await shoot(
      page,
      '04',
      'event-wizard',
      'Create an event — guided setup',
      'Step 1 of the three-step guided setup: name, tagline and event type. The event stays a draft until the organizer publishes it, and everything can be changed later.',
    );
  });

  await step('05', 'Tickets and orders', async () => {
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await shoot(
      page,
      '05',
      'tickets-orders',
      'Tickets & Orders',
      'Ticket types with price, all-in buyer price and sales against inventory, then the most recent orders. Also here: the box office, checkout questions and the buyer email check.',
    );
  });

  await step('06', 'Order page', async () => {
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    const link = page.getByRole('main').getByRole('link', { name: 'Hannah Weiss' }).first();
    await link.waitFor();
    await page.goto((await link.getAttribute('href')) ?? '');
    await shoot(
      page,
      '06',
      'order',
      'Order detail',
      'One order: what was paid, each ticket with its holder and code, fraud signals and every email sent about the order. Further down (full page) is the refund panel, which follows the event’s refund policy.',
    );
  });

  await step('07', 'Attendees list', async () => {
    await page.goto(`${SUMMIT}/attendees`);
    const box = page.locator('tbody input[type="checkbox"]');
    if ((await box.count()) >= 3) for (let i = 0; i < 3; i++) await box.nth(i).check({ force: true });
    await shoot(
      page,
      '07',
      'attendees',
      'Attendees',
      'Everyone attending the summit with ticket type, seat, payment status and order. Quick filters (registered, needs a seat, awaiting payment, waitlist), search and import. (Demo figures for a large conference.)',
    );
    // Bulk actions on real attendees too (the open house).
    await page.goto(`${OPEN_HOUSE}/attendees`);
    const real = page.locator('tbody input[type="checkbox"]');
    if ((await real.count()) >= 3) {
      for (let i = 0; i < 3; i++) await real.nth(i).check();
      await shoot(
        page,
        '07b',
        'attendees-bulk',
        'Attendees — bulk actions',
        'Selecting people on the attendee list opens bulk actions, such as assigning seats or messaging a group, applied to all of them at once.',
      );
    }
  });

  await step('08', 'Seating chart editor', async () => {
    await page.goto(`${galaBase}/seating`);
    await page.getByRole('application', { name: 'Seating plan' }).waitFor();
    await shoot(
      page,
      '08',
      'seating-editor',
      'Seating chart editor',
      'The seating plan for the Lakeside Charity Gala: rows and round tables around the stage, priced and on sale. Every seat can also be edited from an accessible list, not only by dragging on the map.',
    );
  });

  await step('09', 'Check-in', async () => {
    await page.goto(`${socialBase}/onsite`);
    await shoot(
      page,
      '09',
      'check-in',
      'Check-in (door screen)',
      'Check-in for tonight’s Lakeside Autumn Social: arrivals so far, scan or type a ticket code, recent scans, entrances and zones, and the scanner devices (phones that keep scanning offline).',
    );
  });

  await step('10', 'Messaging', async () => {
    await page.goto(`${OPEN_HOUSE}/marketing`);
    await page.getByLabel('Subject').fill('Parking and doors for the Open House');
    await page
      .getByLabel('Message')
      .fill(
        'Hi everyone! Doors open at 5:30 pm. Free parking is available in the north lot, and the entrance is by the lake path. See you there — the Lakeside team',
      );
    await shoot(
      page,
      '10',
      'announcement',
      'Announcement composer',
      'Writing an announcement to everyone attending the Open House, sent by email and push notification, with a preview before sending and a log of past announcements.',
    );
    await page.goto(`${ORG}/emails`);
    await shoot(
      page,
      '10b',
      'email-templates',
      'Email templates',
      'The organizer can rewrite the subject and opening paragraph of every email Yayatoh sends on their behalf (tickets, refunds, reminders…), in each of the 13 supported languages.',
    );
  });

  await step('11', 'Survey results (NPS)', async () => {
    await page.goto(`${supperBase}/marketing/surveys`);
    const link = page.getByRole('table', { name: 'Your surveys' }).getByRole('link').first();
    await link.waitFor();
    await link.click();
    await page.waitForURL(/\/marketing\/surveys\/[0-9a-f-]{36}$/);
    await shoot(
      page,
      '11',
      'survey-results',
      'Post-event survey results',
      'Results of the Spring Supper Club survey: response rate, Net Promoter Score, and a summary of every question, with the written comments. Guests answer from a personal link, no account needed.',
    );
  });

  await step('12', 'Reports', async () => {
    await page.goto(`${OPEN_HOUSE}/analysis`);
    await shoot(
      page,
      '12',
      'reports',
      'Event analysis',
      'Sales, tickets and check-ins for the Open House, with charts over time and by ticket type. Bookings and a gross-to-net finance view sit on the tabs alongside.',
    );
    await page.goto(`${OPEN_HOUSE}/analysis/finance`);
    await shoot(
      page,
      '12b',
      'reports-finance',
      'Event finance',
      'From gross sales to net revenue: refunds, disputes and platform fees, line by line, so the organizer knows exactly what they will receive.',
    );
  });

  await step('13', 'Payouts', async () => {
    await page.goto(`${ORG}/payouts`);
    await shoot(
      page,
      '13',
      'payouts',
      'Payouts and settlements',
      'How ticket money reaches the organizer: connect a bank account for direct payouts, or let Yayatoh collect and settle after the event. Settlements and anything owed are listed with dates.',
    );
  });

  await step('14', 'Team', async () => {
    await page.goto(`${ORG}/team`);
    await shoot(
      page,
      '14',
      'team',
      'Team',
      'Invite teammates by email and give each a role — admin, manager, finance, marketing, box office, scanner or viewer — so everyone sees only what their job needs.',
    );
  });

  await step('15', 'Settings — brand', async () => {
    await page.goto(`${ORG}/settings`);
    await scrollToTop(page.locator('#brand-heading'), 32);
    await settle(page);
    await save(
      page,
      '15-settings-brand',
      { fullPage: false },
      {
        title: 'Settings — brand',
        caption:
          'Organization settings with the brand kit: brand colour and logo carry through to the organizer’s event pages, tenant site and emails.',
        viewport: '1440×900',
        path: `${ORG}/settings`,
      },
    );
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > 980)
      await save(
        page,
        '15-settings-full',
        { fullPage: true },
        {
          title: 'Settings (full page)',
          caption:
            'All organization settings: agreements, general details (name, language, time zone), brand, legal pages and more.',
          viewport: '1440×full',
          path: `${ORG}/settings`,
        },
      );
  });

  await ctx.close();
}

async function buyerShots(browser: Browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();

  await step('16', 'Marketplace home', async () => {
    await page.goto(`${MARKET}/`);
    await shoot(
      page,
      '16',
      'marketplace',
      'Marketplace home',
      'The public Yayatoh marketplace: search upcoming events by name, city, category, price and date. Every price shown includes all fees.',
    );
  });

  await step('17', 'Public event page', async () => {
    await page.goto(`${MARKET}/events/midwest-leadership-summit-2027`);
    await shoot(
      page,
      '17',
      'event-page',
      'Public event page',
      'The Midwest Leadership Summit’s public page: key facts, passes with all-in prices, the agenda, and a way for existing ticket holders to get their tickets again.',
    );
  });

  await step('18', 'Seat picker', async () => {
    await page.goto(`${MARKET}/events/lakeside-charity-gala-2027`);
    const show = page.getByRole('button', { name: 'Show seat map' });
    if (await show.count()) await show.first().click();
    const boxes = page.locator('input[name="seat"]:not([disabled])');
    await boxes.first().waitFor();
    for (const i of [0, 1]) await boxes.nth(i).check();
    const whole = page.getByRole('button', { name: 'Whole room' });
    if (await whole.count())
      await whole
        .first()
        .click({ timeout: 2_000 })
        .catch(() => {});
    await scrollToTop(page.getByRole('heading', { name: 'Choose your pass' }));
    await settle(page);
    await save(
      page,
      '18-seat-picker',
      { fullPage: false },
      {
        title: 'Seat picker',
        caption:
          'Buyers choose their exact seats for the Lakeside Charity Gala on the seat map (or from a list). Taken seats are greyed out live, and seats are held while the buyer pays.',
        viewport: '1440×900',
        path: 'yayatoh.localhost/events/lakeside-charity-gala-2027',
      },
    );
    await save(
      page,
      '18-seat-picker-full',
      { fullPage: true },
      {
        title: 'Seat picker (full page)',
        caption: 'The whole gala page with the seat map and the list of seats.',
        viewport: '1440×full',
        path: 'yayatoh.localhost/events/lakeside-charity-gala-2027',
      },
    );
  });

  let order: { page: Page; context: BrowserContext; url: string } | undefined;
  await step('19', 'Guest checkout', async () => {
    order = await buy(
      browser,
      'lakeside-open-house',
      'Chloe Anderson',
      { qty: { 'General admission': 2 } },
      {
        beforeVerify: async (p) => {
          await p.getByLabel('Verification code', { exact: true }).scrollIntoViewIfNeeded();
          await p.evaluate(() => window.scrollBy(0, 200));
          await shoot(
            p,
            '19',
            'checkout-email-code',
            'Guest checkout — email code',
            'Guest checkout without an account: before paying, the buyer confirms their email with a 6-digit code, so tickets never go to a mistyped address.',
            { full: false, path: '/events/lakeside-open-house' },
          );
        },
        beforePay: async (p) => {
          await shoot(
            p,
            '19b',
            'checkout-payment',
            'Checkout — payment',
            'The payment step with the order total (test payment page in this preview; live events use the payment provider’s secure card form).',
            { full: false, path: '/checkout' },
          );
        },
      },
    );
  });

  await step('20', 'Order confirmation with QR ticket', async () => {
    if (!order) return 'No order was placed (checkout step failed).';
    await shoot(
      order.page,
      '20',
      'order-confirmation',
      'Order confirmation and tickets',
      'What the buyer sees after paying: the order is confirmed and each ticket has its own QR code to show at the door, with a PDF download and optional push notifications for event updates.',
      { path: '/orders/…' },
    );
  });

  await step('21', 'Tenant site', async () => {
    await page.goto(`${LAKESIDE_SITE}/`);
    await shoot(
      page,
      '21',
      'tenant-site',
      'Organizer’s own site',
      'Lakeside Events’ own branded site (on its own web address), listing only their events. Organizers can also connect a custom domain.',
    );
  });

  await step('22', 'Mobile public event page and ticket', async () => {
    const m = await newContext(browser, 375, 812, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto(`${MARKET}/events/midwest-leadership-summit-2027`);
    await shoot(
      mp,
      '22',
      'mobile-event-page',
      'Mobile — public event page',
      'The same event page on a phone. Every public page is designed mobile-first.',
      { full: false },
    );
    if (order) {
      await mp.goto(`${WEB}${order.url}`);
      await mp
        .getByText('Paid', { exact: true })
        .first()
        .waitFor()
        .catch(() => {});
      await shoot(
        mp,
        '22b',
        'mobile-ticket',
        'Mobile — ticket',
        'The buyer’s ticket on a phone, with the QR code ready to scan at the door.',
        { full: true, path: '/orders/…' },
      );
    } else {
      skipped.push({
        id: '22b',
        title: 'Mobile — ticket',
        reason: 'No order was placed (checkout step failed).',
      });
    }
    await m.close();
  });

  await step('23', 'Arabic (right to left)', async () => {
    await page.goto(`${MARKET}/ar/events/midwest-leadership-summit-2027`);
    await shoot(
      page,
      '23',
      'arabic-event-page',
      'Arabic — public event page',
      'The event page in Arabic, laid out right to left. Yayatoh ships in 13 languages.',
      { full: false },
    );
    const c = await newContext(browser);
    const cp = await c.newPage();
    await signIn(cp);
    await cp.goto(`/ar${ORG}`);
    await shoot(
      cp,
      '23b',
      'arabic-dashboard',
      'Arabic — organizer dashboard',
      'The organizer console in Arabic, mirrored right to left, including navigation and numbers.',
      { full: false },
    );
    await c.close();
  });

  if (order) await order.context.close();
  await ctx.close();
}

async function scanShots(browser: Browser) {
  await step('24', 'Scan app', async () => {
    const socialBase = state.socialBase ?? `${ORG}/e/lakeside-autumn-social`;
    const c = await newContext(browser);
    const p = await c.newPage();
    await signIn(p);
    // A fresh device for this capture (its key is shown once, never in the screenshots).
    await p.goto(`${socialBase}/onsite`);
    await p.getByLabel('Device name').fill('Main entrance');
    await p.getByRole('button', { name: 'Add device' }).click();
    const link = await p.getByTestId('scan-link').getAttribute('href');
    if (!link) throw new Error('no device link');
    // A ticket nobody has scanned yet: buy one now.
    const o = await buy(browser, 'lakeside-autumn-social', 'Leila Haddad', { qty: { Entry: 1 } });
    const code = ((await o.page.locator('.tracking-\\[0\\.2em\\]').first().textContent()) ?? '').trim();
    await o.context.close();
    await p.goto(`${socialBase}/onsite`); // the key panel is gone once the page is reloaded
    await c.close();

    const d = await newContext(browser, 390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const device = await d.newPage();
    await device.goto(link.startsWith('http') ? link : `${WEB}${link}`);
    await device.getByText(/tickets? on this device/).waitFor();
    await shoot(
      device,
      '24',
      'scan-app',
      'Scan app — ready to scan',
      'The door scanner on a phone. It downloads the guest list for offline use, so scanning keeps working if the Wi-Fi drops.',
      { full: false, path: '/scan' },
    );
    const field = device.getByLabel('Ticket code');
    await field.fill(code);
    await field.press('Enter');
    await device
      .getByRole('status')
      .filter({ has: device.locator('[data-result]') })
      .getByText('Welcome in')
      .waitFor();
    await shoot(
      device,
      '24b',
      'scan-welcome-in',
      'Scan app — “Welcome in”',
      'A valid ticket scanned: a big, clear “Welcome in” with the guest’s name and ticket type, confirmed by the server.',
      { full: false, path: '/scan' },
    );
    await d.close();
  });
}

async function adminShots(browser: Browser) {
  await step('25', 'Staff admin console', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: ADMIN });
    const p = await c.newPage();
    await p.goto('/sign-in');
    await p.getByLabel('Email', { exact: true }).fill(STAFF);
    await p.getByLabel('Password', { exact: true }).fill(process.env.DEV_PERSONA_PASSWORD ?? '');
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL((u) => !u.pathname.endsWith('/sign-in'));
    await p.goto('/');
    await shoot(
      p,
      '25',
      'admin-home',
      'Staff admin — home',
      'Yayatoh’s own staff console: every organization on the platform, with search and status, for support and oversight. Every staff action is logged.',
    );
    await p.goto('/?q=lakeside');
    await p
      .getByRole('link', { name: /Lakeside Events/ })
      .first()
      .click();
    await p.waitForURL(/\/tenants\//);
    await shoot(
      p,
      '25b',
      'admin-org-detail',
      'Staff admin — organization detail',
      'One organization as Yayatoh staff see it: its details and status, with controls such as suspending or closing it. Every action needs a reason and is kept in the audit log.',
    );
    await c.close();
  });
}

// ————————————————————————————————————————————————————————— main

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  args: [
    `--host-resolver-rules=MAP *.yayatoh.events 127.0.0.1, MAP *.verified.test 127.0.0.1`,
    '--font-render-hinting=none',
  ],
});
try {
  if (!process.env.SKIP_SETUP) {
    log('setup');
    await setup(browser);
  }
  await organizerShots(browser);
  await buyerShots(browser);
  await scanShots(browser);
  await adminShots(browser);
} finally {
  await browser.close();
}

const manifestPath = `${OUT_DIR}/manifest.json`;
let previous: { shots?: Shot[]; skipped?: typeof skipped } = {};
if (only.size > 0) {
  try {
    const { readFileSync } = await import('node:fs');
    previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {}
}
const byFile = new Map((previous.shots ?? []).map((s) => [s.file, s]));
for (const s of shots) byFile.set(s.file, s);
const skippedIds = new Set(skipped.map((s) => s.id));
const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  shots: [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file)),
  skipped: [
    ...(previous.skipped ?? []).filter((s) => !want(s.id.slice(0, 2)) && !skippedIds.has(s.id)),
    ...skipped,
  ],
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
log(`done: ${shots.length} screenshots, ${skipped.length} skipped`);
