import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { findUserByEmail } from '@yayatoh/auth';
import { closePools } from '@yayatoh/db';
import { assignEventRoleCommand, createEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { ports, type SocialPackScenario, socialPackScenario } from '@yayatoh/testing';
import { expectAccessible, expectAccessibleBothModes, newUser, signIn } from './helpers.ts';

// Dietary and accessibility answers are sealed with the org's key: use the web server's vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

// axe in light and dark, a fresh org and a 47-guest fixture per test.
test.describe.configure({ timeout: 180_000 });

/**
 * M4.6a social Command Center pack. The acceptance ("42 guests have not responded to RSVP" on the
 * alerts page and the Command Center, clearing as a household answers on its RSVP page), the
 * RSVP, guest seating, meals and arrivals widgets with their empty states, the door's view (no
 * RSVP chasing, no meals; refused when asked directly), keyboard only, axe in light and dark,
 * Arabic RTL.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DAY = 86_400_000;

test.afterAll(async () => {
  await closePools();
});

/** A fresh org (its owner signed in on `page`) holding the M4.6a fixture, evaluated. */
async function orgWithWedding(page: Page): Promise<{ slug: string; s: SocialPackScenario }> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, s: await socialPackScenario(org.orgId) };
}

let lakeside: string | null = null;
/** The fixture in Lakeside Events (owner pani@, viewer jordan@), not evaluated (widgets only). */
async function lakesideWedding(): Promise<SocialPackScenario> {
  lakeside ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!lakeside) throw new Error('no lakeside-events org (seed?)');
  return socialPackScenario(lakeside, { evaluate: false });
}

/** What the worker does every few seconds: the outbox through the subscribers, then the sweep. */
async function drain(page: Page, slug: string) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: slug, sweep: '1' } });
  expect(res.status()).toBe(200);
}

const shown = (page: Page) =>
  page
    .getByTestId('command-center')
    .locator('[data-testid^="cc-widget-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('cc-widget-', '')));

async function setClock(context: BrowserContext, at: number | null) {
  await context.clearCookies({ name: 'yy_dev_clock_offset' });
  if (at !== null)
    await context.addCookies([
      {
        name: 'yy_dev_clock_offset',
        value: String(Math.round(at - Date.now())),
        url: `http://localhost:${PORT}`,
      },
    ]);
}

const ACCEPTANCE = '42 guests have not responded to RSVP';

test.describe('social Command Center pack (M4.6a)', () => {
  test('the fixture gives exactly “42 guests have not responded to RSVP”: alerts page, Command Center, keyboard, axe, Arabic', async ({
    page,
  }) => {
    const { slug, s } = await orgWithWedding(page);
    // The alerts page: the one alert, worded exactly, linking to the RSVP page.
    await page.goto(`/o/${slug}/alerts`);
    const titles = page.getByRole('main').getByRole('heading', { level: 2 });
    await expect(titles).toHaveCount(1);
    await expect(titles).toHaveText(ACCEPTANCE);
    await expect(page.getByRole('link', { name: 'Open RSVPs' })).toHaveAttribute(
      'href',
      `/o/${slug}/e/${s.eventSlug}/guests/rsvp`,
    );
    await expectAccessibleBothModes(page);

    // The Command Center (planning): the RSVP widget leads, saying the same.
    const base = `/o/${slug}/e/${s.eventSlug}`;
    await page.goto(`${base}/command-center`);
    const cc = page.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-mode', 'planning');
    expect(await shown(page)).toEqual(['readiness', 'rsvp', 'alerts', 'guestSeating', 'meals', 'timeline']);
    await expect(page.getByTestId('cc-rsvp-pending')).toHaveText(ACCEPTANCE);
    await expect(page.getByTestId('cc-widget-alerts')).toContainText(ACCEPTANCE);
    await expect(page.getByTestId('cc-rsvp-responded')).toHaveText('3 of 45 invited guests have responded');
    await expect(page.getByTestId('cc-rsvp')).toContainText(
      'Parties still to answer: 14 · Not sent an invitation yet: 12',
    );
    await expect(page.getByTestId('cc-rsvp-deadline')).toContainText('RSVP deadline:');
    await expectAccessibleBothModes(page);

    // Keyboard only: follow the widget's link to the RSVP page.
    const open = page.getByTestId('cc-widget-rsvp').getByRole('link', { name: 'Open RSVPs' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${base}/guests/rsvp$`));

    // Arabic, right to left: the same sentence in Arabic.
    await page.goto(`/ar${base}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('cc-rsvp-pending')).toHaveText(/ضيفًا لم يردّوا على الدعوة/);
    await expect(page.getByTestId('cc-widget-rsvp')).toContainText('الردود على الدعوة');
    await expectAccessible(page);
  });

  test('it clears as guests answer: a household answers on its RSVP page by keyboard → 39, persisted', async ({
    page,
    browser,
  }) => {
    const { slug, s } = await orgWithWedding(page);
    const first = s.pending[0];
    if (!first) throw new Error('no household');
    // The household's own page, keyboard only.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(`/rsvp/${encodeURIComponent(s.firstToken)}`);
    for (const name of ['Alex', 'Sam', 'Robin']) {
      const yes = guest
        .getByRole('group', { name: `${name} ${first.name}, Ceremony and reception`, exact: true })
        .getByRole('radio', { name: 'Attending' });
      await yes.focus();
      await guest.keyboard.press('Space');
      await expect(yes).toBeChecked();
    }
    await guest.getByRole('button', { name: 'Send RSVP' }).focus();
    await guest.keyboard.press('Enter');
    await expect(
      guest.getByRole('status').filter({ hasText: 'Thank you! Your RSVP is saved.' }),
    ).toBeVisible();
    await guestContext.close();

    // The worker picks up the answer: the alert now counts 39, and so does the widget.
    await drain(page, slug);
    await page.goto(`/o/${slug}/alerts`);
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText(
      '39 guests have not responded to RSVP',
    );
    await page.goto(`/o/${slug}/e/${s.eventSlug}/command-center`);
    await expect(page.getByTestId('cc-rsvp-pending')).toHaveText('39 guests have not responded to RSVP');
    await expect(page.getByTestId('cc-rsvp-responded')).toHaveText('6 of 45 invited guests have responded');
    await page.reload();
    await expect(page.getByTestId('cc-rsvp-pending')).toHaveText('39 guests have not responded to RSVP');

    // Everyone else answers (the host records paper replies): the alert resolves, the widget says so.
    for (const p of s.pending.slice(1)) await s.answer(p, 'declined');
    await drain(page, slug);
    await page.goto(`/o/${slug}/e/${s.eventSlug}/command-center`);
    await expect(page.getByTestId('cc-rsvp-pending')).toHaveText('Everyone invited has responded.');
    await expect(page.getByTestId('cc-widget-alerts')).toContainText('No open alerts.');
    await expectAccessibleBothModes(page);
  });

  test('guest seating, meals and dietary counts while planning; arrivals live (mocked clock); empty states', async ({
    page,
    context,
  }) => {
    const s = await lakesideWedding();
    await signIn(page);
    const base = `/o/lakeside-events/e/${s.eventSlug}`;
    await page.goto(`${base}/command-center`);
    // Guests without a table: the alert's words, the seated share and the first names.
    await expect(page.getByTestId('cc-guest-unseated')).toHaveText('33 guests do not have a table');
    const seating = page.getByTestId('cc-guest-seating');
    await expect(seating).toContainText('11 of 44 guests have a table');
    await expect(
      seating.getByRole('list', { name: 'Guests without a table' }).getByRole('listitem'),
    ).toHaveCount(9);
    await expect(seating).toContainText('+25 more');
    await expect(seating).not.toContainText('Rivera');
    // Meals: per menu option with its notes; needs counted, never shown.
    const meals = page.getByTestId('cc-meals');
    await expect(page.getByTestId('cc-meals-attending')).toHaveText('Attending: 2');
    const table = meals.getByRole('table', { name: 'Meals of attending guests' });
    await expect(table.getByRole('row', { name: /Beef/ })).toContainText('1');
    await expect(table.getByRole('row', { name: /Risotto/ })).toContainText('Vegetarian');
    await expect(table.getByRole('row', { name: /No meal chosen/ })).toContainText('1');
    await expect(page.getByTestId('cc-meals-needs')).toHaveText(
      'Dietary requirements: 1 · Accessibility needs: 1',
    );
    await expect(page.getByTestId('command-center')).not.toContainText('Gluten');
    await expectAccessibleBothModes(page);

    // Keyboard: the meals widget's link opens the RSVP answers.
    await meals.getByRole('link', { name: 'Open RSVP answers' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${base}/guests/answers$`));

    // Live (the clock moved to the wedding): arrivals join; nobody yet, then Sofia.
    await setClock(context, s.startsAt.getTime() + 3_600_000);
    await page.goto(`${base}/command-center`);
    await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'live');
    await expect(page.getByTestId('cc-arrivals-count')).toHaveText('0 of 44 expected guests have arrived');
    await expect(page.getByTestId('cc-arrivals')).toContainText('No one has arrived yet.');
    await s.arriveSofia();
    await page.reload();
    await expect(page.getByTestId('cc-arrivals-count')).toHaveText('1 of 44 expected guests have arrived');
    await expect(page.getByRole('list', { name: 'Latest arrivals' })).toContainText('Sofia Rivera');
    await expect(page.getByRole('list', { name: 'Latest arrivals' })).toContainText('Rivera · Host');
    await expectAccessibleBothModes(page);
    await page.goto(`/ar${base}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('cc-widget-arrivals')).toContainText('وصول الضيوف');
    await expectAccessible(page);
    await setClock(context, null);

    // Empty states: a wedding with no guests yet says what comes next.
    const bare = await executeCommand(
      createEventCommand,
      {
        name: `Bare wedding ${uuidv7().slice(-6)}`,
        slug: `bare-${uuidv7().slice(-8)}`,
        profile: 'wedding',
        timezone: 'America/Chicago',
        startsAt: new Date(Date.now() + 20 * DAY).toISOString(),
        endsAt: new Date(Date.now() + 20 * DAY + 3_600_000).toISOString(),
      },
      createCtx({ orgId: s.orgId, actor: { type: 'system', name: 'e2e' } }),
      ports,
    );
    await page.goto(`/en/o/lakeside-events/e/${bare.slug}/command-center`);
    await expect(page.getByTestId('cc-rsvp')).toContainText('No one has been invited to a sub-event yet.');
    await expect(page.getByTestId('cc-rsvp-deadline')).toHaveText('No RSVP deadline set');
    await expect(page.getByTestId('cc-guest-seating')).toContainText(
      'No guest floor plan yet. Choose one in Seating.',
    );
    await expect(page.getByTestId('cc-meals')).toContainText('Meals are counted once guests say yes.');
    await expectAccessible(page);
  });

  test('the door sees guest seating and arrivals, never RSVP chasing or meals, even asking directly', async ({
    page,
    browser,
  }) => {
    const s = await lakesideWedding();
    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    const doorUser = await newUser(door, {
      join: ['lakeside-events:viewer'],
      name: `Dee Door ${Date.now()}`,
    });
    const account = await findUserByEmail(doorUser.email);
    if (!account) throw new Error('no door user');
    await executeCommand(
      assignEventRoleCommand,
      { eventId: s.eventId, userId: account.id, role: 'door_staff' },
      createCtx({ orgId: s.orgId, actor: { type: 'system', name: 'e2e' } }),
      ports,
    );
    await setClock(doorContext, s.startsAt.getTime() + 3_600_000);
    const base = `/o/lakeside-events/e/${s.eventSlug}`;
    await door.goto(`${base}/command-center`);
    const cc = door.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-role', 'door');
    const keys = await shown(door);
    expect(keys).toEqual(expect.arrayContaining(['arrivals', 'guestSeating']));
    expect(keys).not.toContain('rsvp');
    expect(keys).not.toContain('meals');
    await expect(door.getByTestId('cc-arrivals-count')).toContainText('of 44 expected guests have arrived');
    await expect(door.getByTestId('cc-guest-unseated')).toHaveText('33 guests do not have a table');
    // Customizing can't bring RSVP or meals back.
    await door.getByRole('button', { name: 'Customize layout' }).click();
    await expect(door.getByRole('button', { name: /Show RSVP/ })).toHaveCount(0);
    await expect(door.getByRole('button', { name: /Show Meals/ })).toHaveCount(0);
    await expectAccessible(door);
    // Direct loader calls: refused for the door; the owner gets them.
    const api = `/api/command-center/lakeside-events/${s.eventSlug}`;
    for (const w of ['rsvp', 'meals']) expect((await door.request.get(`${api}/${w}`)).status()).toBe(403);
    expect((await door.request.get(`${api}/arrivals`)).status()).toBe(200);
    await signIn(page);
    const owner = await page.request.get(`${api}/rsvp`);
    expect(owner.status()).toBe(200);
    expect(await owner.json()).toMatchObject({ widget: 'rsvp', data: { pending: 42, invited: 45 } });
    // Another org's owner gets nothing.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, 'maya@rosewood.test');
    expect((await other.request.get(`${api}/rsvp`)).status()).toBe(404);
    await doorContext.close();
  });
});
