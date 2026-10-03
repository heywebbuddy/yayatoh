import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  newUser,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * M6.10a — virtual v2: Cloudflare Stream as a second provider (fake), a session's provider
 * switched while an attendee watches (the attendee keeps access and minutes), the RTMP backup
 * ingest, a Zoom webinar created from Yayatoh through the org's Zoom connection (fake consent and
 * fake Zoom API), and Zoom join/leave webhooks delivered twice to the real endpoint (counted once).
 * Each Zoom test runs in its own new org so the connection never collides across projects.
 */

const VIEWER = 'jordan@lakeside.test';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

interface Person {
  readonly name: string;
  readonly email: string;
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

const ana = (f: Fixture) => f.people.find((p) => p.name === 'Ana') as Person;

/** A published conference under way in `org` (in person until set up), Ana and Ben registered. */
async function conference(page: Page, org: string): Promise<Fixture> {
  const res = await page.request.post('/api/dev/virtual', { form: { org, name: `Virtual v2 ${stamp()}` } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Fixture;
}

/** A new org owned by a new user signed in on `page`, with Zoom connected (fake consent). */
async function zoomOrg(page: Page): Promise<string> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const org = owner.orgSlug as string;
  await page.goto(`/o/${org}/integrations`);
  await page.getByRole('button', { name: 'Connect Zoom' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Zoom to Yayatoh?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('Zoom is connected. The first sync starts shortly.')).toBeVisible();
  return org;
}

async function guest(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/** Hybrid delivery, Ana's pass in person and online, a stream on the opening keynote (default). */
async function setUp(page: Page, f: Fixture) {
  await page.goto(`${f.path}/virtual`);
  await page.getByRole('radio', { name: /^Hybrid/ }).check();
  await page.getByRole('button', { name: 'Save delivery' }).click();
  await expect(page.getByText('Delivery saved.')).toBeVisible();
  const anaType = page.getByRole('group', { name: ana(f).ticketType });
  await anaType.getByRole('radio', { name: 'In person and online' }).check();
  await page.getByRole('button', { name: `Save access for ${ana(f).ticketType}` }).click();
  await expect(page.getByText(`Access saved for ${ana(f).ticketType}.`)).toBeVisible();
  await page.getByRole('button', { name: 'Set up a stream for Opening keynote' }).click();
  await expect(page.getByText('Stream ready for Opening keynote.')).toBeVisible();
}

const providerField = (page: Page, title: string) =>
  page.getByRole('combobox', { name: `Video provider for ${title}` });
const keynoteRow = (page: Page) => page.getByRole('row', { name: /Opening keynote/ }).first();
/** A session's card in the Zoom webinars section (M6.9b's layout). */
const zoomCard = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, level: 3 }) });

/** Deliver a signed Zoom webhook (built by the fake Zoom) to the real endpoint. */
async function zoomWebhook(
  page: Page,
  p: { webinar: string; email: string; kind: 'joined' | 'left'; at: Date },
): Promise<{ status: number; outcome: string | undefined }> {
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
  const json = (await res.json().catch(() => ({}))) as { outcome?: string };
  return { status: res.status(), outcome: json.outcome };
}

test.describe('virtual v2 (M6.10a)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('create a Zoom webinar, switch a session’s provider while Ana watches (she keeps access), backup ingest, join/leave webhooks count once', async ({
    page,
    browser,
  }) => {
    const org = await zoomOrg(page);
    const f = await conference(page, org);
    await setUp(page, f);
    // Both providers are offered; the keynote streams on the default one.
    await expect(keynoteRow(page).getByTestId('stream-provider')).toHaveText('Mux (test)');
    await expectPicked(providerField(page, 'Opening keynote'), 'fake');

    // Ana starts watching on the Mux fake.
    const a = await guest(browser);
    await a.goto(ana(f).watch);
    await a.getByRole('link', { name: 'Watch Opening keynote' }).click();
    await a.getByRole('button', { name: 'Start watching' }).click();
    await expect(a.getByTestId('player-status')).toHaveText('Playing');
    await expect(a.getByTestId('watched-minutes')).toHaveText('Watched 1 minute');

    // The organizer moves the keynote to Cloudflare Stream.
    await pickOption(providerField(page, 'Opening keynote'), { label: 'Cloudflare Stream (test)' });
    await page.getByRole('button', { name: 'Switch the video provider for Opening keynote' }).click();
    await expect(
      page.getByText(
        'Opening keynote now streams on Cloudflare Stream (test). Viewers keep their access and watch time.',
      ),
    ).toBeVisible();
    await page.reload();
    await expect(keynoteRow(page).getByTestId('stream-provider')).toHaveText('Cloudflare Stream (test)');
    await expect(keynoteRow(page).getByText('On', { exact: true })).toBeVisible();

    // Ana's player follows: her old token is refused with "provider changed", it starts a new
    // viewing at Cloudflare and carries on. Her minute is still there.
    await a.getByRole('button', { name: 'Pause' }).click();
    await a.getByRole('button', { name: 'Resume' }).click();
    await expect(a.getByText("The stream moved to another provider. You're still watching.")).toBeVisible();
    await expect(a.getByTestId('player-status')).toHaveText('Playing');
    await expect(a.getByTestId('watched-minutes')).toHaveText(/Watched [12] minutes?/);
    await expectAccessibleBothModes(a);
    // Her watch page still lists the keynote (the grant is kept).
    await a.goto(ana(f).watch);
    await expect(a.getByRole('link', { name: 'Watch Opening keynote' })).toBeVisible();

    // RTMP overflow: the encoder moves to Cloudflare's backup ingest, same key.
    await page.getByRole('button', { name: 'Show the stream key for Opening keynote' }).click();
    const key = await page.getByTestId('stream-key').textContent();
    expect(key).toMatch(/^fake-cf-sk-[0-9a-f]{32}$/);
    await page.getByRole('button', { name: 'Use the backup ingest for Opening keynote' }).click();
    await expect(
      page.getByText('Opening keynote now uses the backup ingest. Point your encoder at the backup server.'),
    ).toBeVisible();
    await page.reload();
    await expect(keynoteRow(page).getByText('Backup ingest', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show the stream key for Opening keynote' }).click();
    await expect(page.getByText('Server (backup ingest)')).toBeVisible();
    await expect(page.getByTestId('ingest-url')).toHaveText(/^rtmp:\/\/backup\./);
    await expect(page.getByTestId('stream-key')).toHaveText(key as string);
    await expectAccessible(page);

    // Zoom: create the closing panel's webinar from here.
    await expect(page.getByRole('heading', { name: 'Zoom webinars', level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'Create a Zoom webinar for Closing panel' }).click();
    await expect(page.getByText('Zoom webinar created for Closing panel.')).toBeVisible();
    await page.reload();
    const panel = zoomCard(page, 'Closing panel');
    await expect(panel.getByLabel('Zoom webinar ID')).toHaveValue(/^[0-9]{11}$/);
    await expect(panel.getByText('Created here')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a Zoom webinar for Closing panel' })).toHaveCount(0);
    // Ana (online access) is registered; Ben's in-person day pass is not.
    await expect(panel.getByTestId('zoom-counts')).toHaveText('Registrants: 1 · Attended: 0');
    await expectAccessibleBothModes(page);

    // Zoom tells us Ana joined and left; each webhook is delivered twice and counts once.
    const webinar = await panel.getByLabel('Zoom webinar ID').inputValue();
    const joined = new Date(Date.now() - 20 * 60_000);
    const left = new Date(Date.now() - 2 * 60_000);
    for (const [kind, at] of [
      ['joined', joined],
      ['left', left],
    ] as const) {
      expect(await zoomWebhook(page, { webinar, email: ana(f).email, kind, at })).toEqual({
        status: 200,
        outcome: 'recorded',
      });
      expect(await zoomWebhook(page, { webinar, email: ana(f).email, kind, at })).toEqual({
        status: 200,
        outcome: 'duplicate',
      });
    }
    await page.reload();
    await expect(zoomCard(page, 'Closing panel').getByTestId('zoom-counts')).toHaveText(
      'Registrants: 1 · Attended: 1',
    );
  });

  test('the Zoom webhook refuses an unsigned or forged request before reading it', async ({ page }) => {
    const body = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'abc' } });
    const unsigned = await page.request.post('/api/webhooks/zoom', {
      data: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(unsigned.status()).toBe(401);
    const forged = await page.request.post('/api/webhooks/zoom', {
      data: body,
      headers: {
        'content-type': 'application/json',
        'x-zm-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-zm-signature': `v0=${'0'.repeat(64)}`,
      },
    });
    expect(forged.status()).toBe(401);
  });

  test('without a Zoom connection the card says what to do; a viewer sees everything read-only', async ({
    page,
    browser,
  }) => {
    const f = await conference(page, 'lakeside-events');
    await signIn(page);
    await setUp(page, f);
    // Lakeside has no Zoom connection: the card says so and links to connect it.
    await expect(page.getByText("Zoom isn't connected")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Connect Zoom' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create a Zoom webinar for Closing panel' }),
    ).toBeDisabled();
    await expectAccessible(page);

    const v = await guest(browser);
    await signIn(v, VIEWER);
    await v.goto(`${f.path}/virtual`);
    await expect(v.getByText('You can see the streaming setup. Only editors can change it.')).toBeVisible();
    await expect(keynoteRow(v).getByTestId('stream-provider')).toHaveText('Mux (test)');
    await expect(v.getByRole('combobox', { name: /Video provider for/ })).toHaveCount(0);
    await expect(
      v.getByRole('button', {
        name: /Switch the video provider|Use the backup ingest|Create a Zoom webinar/,
      }),
    ).toHaveCount(0);
    await expect(v.getByRole('link', { name: 'Connect Zoom in Integrations' })).toHaveCount(0);
    await expectAccessible(v);
  });

  test('keyboard only: choose the provider, switch it, backup ingest, create the webinar', async ({
    page,
  }) => {
    const org = await zoomOrg(page);
    const f = await conference(page, org);
    await page.goto(`${f.path}/virtual`);
    await page
      .getByRole('radio', { name: /^In person/ })
      .first()
      .focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Delivery saved.')).toBeVisible();
    // A new stream straight on Cloudflare: choose it in the list, then Set up.
    await pickWithKeyboard(providerField(page, 'Closing panel'), { label: 'Cloudflare Stream (test)' });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Set up a stream for Closing panel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Stream ready for Closing panel.')).toBeVisible();
    const panelRow = page.getByRole('row', { name: /Closing panel/ }).first();
    await expect(panelRow.getByTestId('stream-provider')).toHaveText('Cloudflare Stream (test)');
    // Back to Mux with the keyboard.
    await pickWithKeyboard(providerField(page, 'Closing panel'), { label: 'Mux (test)' });
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Switch the video provider for Closing panel' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Closing panel now streams on Mux \(test\)/)).toBeVisible();
    const backup = page.getByRole('button', { name: 'Use the backup ingest for Closing panel' });
    await backup.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Closing panel now uses the backup ingest. Point your encoder at the backup server.'),
    ).toBeVisible();
    const create = page.getByRole('button', { name: 'Create a Zoom webinar for Opening keynote' });
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Zoom webinar created for Opening keynote.')).toBeVisible();
  });

  test('Arabic (RTL): providers, backup ingest and the Zoom card', async ({ page }) => {
    const org = await zoomOrg(page);
    const f = await conference(page, org);
    await setUp(page, f);
    await page.goto(`/ar${f.path}/virtual`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: 'Zoom' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'مزوّد الفيديو لـ Opening keynote' })).toBeVisible();
    await page.getByRole('button', { name: 'استخدام الإدخال الاحتياطي لـ Opening keynote' }).click();
    await expect(page.getByText(/يستخدم Opening keynote الآن الإدخال الاحتياطي/)).toBeVisible();
    await page.getByRole('button', { name: 'إنشاء ندوة Zoom لـ Closing panel' }).click();
    await expect(page.getByText('أُنشئت ندوة Zoom لـ Closing panel.')).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
