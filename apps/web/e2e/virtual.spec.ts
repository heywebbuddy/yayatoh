import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, signIn } from './helpers.ts';

/**
 * M6.9a — virtual v1: the organizer's stream setup (delivery mode, access per ticket type, a live
 * stream per session with its key), the attendee's watch page and player (fake video provider:
 * the CDN check and a test pattern), heartbeat watch time once a minute, and the virtual
 * checkpoint on the setup page.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = 'lakeside-events';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

interface Person {
  readonly name: string;
  readonly token: string;
  readonly watch: string;
  readonly ticketType: string;
}
interface Fixture {
  readonly slug: string;
  readonly path: string;
  readonly sessions: { id: string; title: string }[];
  readonly people: Person[];
}

/** A published conference under way (in person until the test changes it), Ana and Ben registered. */
async function conference(page: Page, opts: { sessions?: boolean } = {}): Promise<Fixture> {
  const res = await page.request.post('/api/dev/virtual', {
    form: { org: ORG, name: `Virtual ${stamp()}`, ...(opts.sessions === false ? { sessions: '0' } : {}) },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Fixture;
}

const ana = (f: Fixture) => f.people.find((p) => p.name === 'Ana') as Person;
const ben = (f: Fixture) => f.people.find((p) => p.name === 'Ben') as Person;

async function guest(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

const radio = (page: Page, name: RegExp) => page.getByRole('radio', { name });

/** Hybrid delivery, Ana's pass in person and online, a stream on the opening keynote. */
async function setUp(page: Page, f: Fixture) {
  await page.goto(`${f.path}/virtual`);
  await radio(page, /^Hybrid/).check();
  await page.getByRole('button', { name: 'Save delivery' }).click();
  await expect(page.getByText('Delivery saved.')).toBeVisible();
  const anaType = page.getByRole('group', { name: ana(f).ticketType });
  await anaType.getByRole('radio', { name: 'In person and online' }).check();
  await page.getByRole('button', { name: `Save access for ${ana(f).ticketType}` }).click();
  await expect(page.getByText(`Access saved for ${ana(f).ticketType}.`)).toBeVisible();
  await page.getByRole('button', { name: 'Set up a stream for Opening keynote' }).click();
  await expect(page.getByText('Stream ready for Opening keynote.')).toBeVisible();
}

test('organizer sets up a virtual session; the attendee watches; watch time and the virtual checkpoint appear', async ({
  page,
  browser,
}) => {
  // The whole story (setup, two attendees, axe in both modes, the outbox) on one event.
  test.setTimeout(120_000);
  const f = await conference(page);
  await signIn(page);
  await page.goto(`${f.path}/virtual`);
  await expect(page.getByRole('heading', { name: 'Stream setup', level: 1 })).toBeVisible();
  // In the event's navigation (conference profile)
  // (collapsed behind the menu on phones and tablets, so present rather than visible there).
  await expect(page.locator(`a[href$="${f.path}/virtual"]`).first()).toBeAttached();
  // In person until changed: nothing can stream.
  await expect(page.getByText('This event is in person, so no session is streamed.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up a stream for Opening keynote' })).toBeDisabled();
  await expectAccessibleBothModes(page);

  await setUp(page, f);
  const row = page.getByRole('row', { name: /Opening keynote/ });
  await expect(row.getByText('On', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Closing panel/ }).getByText('No stream')).toBeVisible();
  // The encoder's key comes from the provider on request (never stored).
  await page.getByRole('button', { name: 'Show the stream key for Opening keynote' }).click();
  await expect(page.getByTestId('stream-key')).toHaveText(/^fake-sk-[0-9a-f]{32}$/);
  await expect(page.getByTestId('ingest-url')).toHaveText(/^rtmps:\/\//);
  await expectAccessible(page);
  // Persisted after reload.
  await page.reload();
  await expect(radio(page, /^Hybrid/)).toBeChecked();
  await expect(
    page.getByRole('group', { name: ana(f).ticketType }).getByRole('radio', { name: 'In person and online' }),
  ).toBeChecked();

  // Ana (in person and online) finds "Watch online" on her order page and watches.
  const a = await guest(browser);
  await a.goto(`/orders/${ana(f).token}`);
  await a.getByRole('link', { name: /Watch online with ticket/ }).click();
  await expect(a.getByRole('heading', { name: 'Watch online', level: 1 })).toBeVisible();
  await expect(a.getByText('Hi Ana. Choose a session to watch.')).toBeVisible();
  await expect(a.getByText('Closing panel')).toHaveCount(0);
  await expectAccessibleBothModes(a);
  await a.getByRole('link', { name: 'Watch Opening keynote' }).click();
  await expect(a.getByRole('heading', { name: 'Opening keynote', level: 1 })).toBeVisible();
  await expect(a.getByTestId('watched-minutes')).toHaveText('Not watched yet');
  await a.getByRole('button', { name: 'Start watching' }).click();
  await expect(a.getByTestId('player-status')).toHaveText('Playing');
  await expect(a.getByText('Test stream: no video is broadcast in this environment.')).toBeVisible();
  await expect(a.getByTestId('watched-minutes')).toHaveText('Watched 1 minute');
  await expectAccessibleBothModes(a);
  await a.getByRole('button', { name: 'Pause' }).click();
  await expect(a.getByTestId('player-status')).toHaveText('Paused');
  // Pressing play again in the same minute counts nothing more.
  await a.getByRole('button', { name: 'Resume' }).click();
  await expect(a.getByTestId('player-status')).toHaveText('Playing');
  await expect(a.getByTestId('watched-minutes')).toHaveText(/Watched [12] minutes?/);

  // Ben's day pass stays in person (the hybrid default): no link, and his watch page says so.
  const b = await guest(browser);
  await b.goto(`/orders/${ben(f).token}`);
  await expect(b.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(b.getByRole('link', { name: /Watch online/ })).toHaveCount(0);
  await b.goto(ben(f).watch);
  await expect(b.getByText('Your ticket is for in-person attendance')).toBeVisible();
  await expect(b.getByRole('link', { name: /^Watch / })).toHaveCount(0);
  await expectAccessible(b);

  // The organizer sees the watch time; after the outbox runs, the virtual check-in.
  const drained = await page.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
  expect(drained.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('virtual-viewers')).toContainText('1');
  const keynote = page.getByRole('row', { name: /Opening keynote/ });
  await expect(keynote.getByRole('cell').nth(2)).toHaveText('1');
  await expect(keynote.getByRole('cell').nth(3)).toHaveText(/^[12]$/);
  await expect(keynote.getByRole('cell').nth(4)).toHaveText('1');
  // Turning the stream off takes the session off the watch page.
  await page.getByRole('button', { name: 'Turn off the stream for Opening keynote' }).click();
  await expect(page.getByText('The stream for Opening keynote is off.')).toBeVisible();
  await a.goto(ana(f).watch);
  await expect(a.getByText('Nothing is streaming yet')).toBeVisible();
  await expectAccessible(a);
});

test('a forged watch link and a session without a stream are not found', async ({ page }) => {
  const f = await conference(page);
  const forged = ana(f).watch.replace(/~[^/]+$/, '~forged');
  const r1 = await page.goto(forged);
  expect(r1?.status()).toBe(404);
  const keynote = f.sessions[0]?.id as string;
  const r2 = await page.goto(`${ana(f).watch}/${keynote}`);
  expect(r2?.status()).toBe(404);
  // The fake CDN refuses a made-up token.
  const cdn = await page.request.get('/api/dev/video/fkabcdef12?token=nope');
  expect(cdn.status()).toBe(403);
  // A heartbeat without a real token is refused.
  const beat = await page.request.post('/api/virtual/heartbeat', { data: { token: 'x'.repeat(40), seq: 1 } });
  expect(beat.status()).toBe(403);
});

test('a viewer sees the setup read-only; no session shows its empty state', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const f = await conference(page);
  await signIn(page);
  await setUp(page, f);
  const v = await guest(browser);
  await signIn(v, VIEWER);
  await v.goto(`${f.path}/virtual`);
  await expect(v.getByText('You can see the streaming setup. Only editors can change it.')).toBeVisible();
  await expect(v.getByRole('button', { name: 'Save delivery' })).toHaveCount(0);
  await expect(v.getByRole('button', { name: /Save access for/ })).toHaveCount(0);
  await expect(v.getByRole('button', { name: /Set up a stream|Show the stream key|Turn off/ })).toHaveCount(
    0,
  );
  await expect(radio(v, /^Hybrid/)).toBeDisabled();
  await expectAccessible(v);

  const empty = await conference(page, { sessions: false });
  await page.goto(`${empty.path}/virtual`);
  await expect(page.getByText('No sessions yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to sessions' })).toBeVisible();
  await expectAccessible(page);
});

test('keyboard only: delivery, access, stream and the player', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const f = await conference(page);
  await signIn(page);
  await page.goto(`${f.path}/virtual`);
  // Delivery: focus the checked radio, arrow to Hybrid, then Tab to Save and press Enter.
  await radio(page, /^In person/)
    .first()
    .focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(radio(page, /^Hybrid/)).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save delivery' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Delivery saved.')).toBeVisible();
  // Access: the pass's radios, then its Save button.
  const group = page.getByRole('group', { name: ana(f).ticketType });
  await group.getByRole('radio', { name: 'In person only' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(group.getByRole('radio', { name: 'Online only' })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: `Save access for ${ana(f).ticketType}` })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Access saved for ${ana(f).ticketType}.`)).toBeVisible();
  const create = page.getByRole('button', { name: 'Set up a stream for Opening keynote' });
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Stream ready for Opening keynote.')).toBeVisible();

  const a = await guest(browser);
  await a.goto(ana(f).watch);
  const watch = a.getByRole('link', { name: 'Watch Opening keynote' });
  await watch.focus();
  await a.keyboard.press('Enter');
  const start = a.getByRole('button', { name: 'Start watching' });
  await start.focus();
  await a.keyboard.press('Enter');
  await expect(a.getByTestId('watched-minutes')).toHaveText('Watched 1 minute');
  await a.getByRole('button', { name: 'Pause' }).focus();
  await a.keyboard.press('Enter');
  await expect(a.getByTestId('player-status')).toHaveText('Paused');
});

test('Arabic (RTL): the setup page and the watch pages', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const f = await conference(page);
  await signIn(page);
  await setUp(page, f);
  await page.goto(`/ar${f.path}/virtual`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'إعداد البث', level: 1 })).toBeVisible();
  await expectAccessibleBothModes(page);
  const a = await guest(browser);
  await a.goto(`/ar${ana(f).watch}`);
  await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(a.getByRole('heading', { name: 'المشاهدة عبر الإنترنت', level: 1 })).toBeVisible();
  await expectAccessibleBothModes(a);
  await a.goto(`/ar${ana(f).watch}/${f.sessions[0]?.id}`);
  await a.getByRole('button', { name: 'ابدأ المشاهدة' }).click();
  await expect(a.getByTestId('watched-minutes')).toHaveText('شوهدت دقيقة واحدة');
  await expectAccessibleBothModes(a);
});
