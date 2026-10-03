import { expect, type Locator, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { setGuestSitePasswordCommand } from '@yayatoh/guests';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import {
  type GuestSiteScenario,
  guestSiteScenario,
  ports,
  type RsvpScenario,
  rsvpScenario,
} from '@yayatoh/testing';
import { expectAccessibleBothModes, expectPicked, passHumanCheck, pickOption, signIn } from './helpers.ts';

/**
 * M4.5a: the guest website. The host builds it from blocks (validation named on each field),
 * sets the password and publishes; guests meet the password gate (the event's name only), open
 * the site with the password (any case), see the program from the sub-events everyone is invited
 * to, travel, registry and FAQ; a new password locks them out again; past the limit the human
 * check appears. Viewers read only; keyboard only; axe in light and dark; Arabic RTL; noindex and
 * never on the marketplace.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

test.afterAll(async () => {
  await closePools();
});

let orgId: string | null = null;
async function lakeside(): Promise<string> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return orgId;
}
const wedding = async (): Promise<RsvpScenario> => rsvpScenario(await lakeside());
const withSite = async (publish = true): Promise<GuestSiteScenario> =>
  guestSiteScenario(await lakeside(), { publish });

const editor = (s: { eventSlug: string }) => `${ORG}/e/${s.eventSlug}/website`;
const block = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const blockNames = (page: Page) => page.locator('section[aria-labelledby="site-blocks-heading"] ol > li h3');

/** Click a form's submit button and wait for its Server Action to answer. */
async function submit(page: Page, button: Locator) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), button.click()]);
}

async function addSection(page: Page, kind: string) {
  await pickOption(page.getByLabel('Kind of section'), { label: kind });
  await submit(page, page.getByRole('button', { name: 'Add the section' }));
  await expect(page.getByText('Section added. Fill it in above.')).toBeVisible();
}

test.describe('guest website: the host (M4.5a)', () => {
  test('builds the site from blocks: every validation named, publish needs a password, saved after a reload', async ({
    page,
  }) => {
    const s = await wedding();
    await signIn(page);
    await page.goto(editor(s));
    await expect(page.getByRole('heading', { name: 'Website', level: 1 })).toBeVisible();
    await expect(page.getByText('No sections yet')).toBeVisible();
    await expect(page.getByTestId('site-status')).toHaveText(
      'Set a password first: the website can’t be published without one.',
    );
    await expectAccessibleBothModes(page);

    // Publishing without a password is refused (P4-3c).
    await submit(page, page.getByRole('button', { name: 'Publish the website' }));
    await expect(
      page.getByRole('alert').filter({ hasText: 'Set a password before publishing.' }),
    ).toBeVisible();

    // The password: too short, then saved.
    const password = page.getByRole('textbox', { name: 'Password', exact: true });
    await password.fill('abc');
    await submit(page, page.getByRole('button', { name: 'Save the password' }));
    await expect(page.getByText('Use at least 6 characters.')).toBeVisible();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expectAccessibleBothModes(page);
    await password.fill('Lake House');
    await submit(page, page.getByRole('button', { name: 'Save the password' }));
    await expect(page.getByText('Password saved.')).toBeVisible();
    await expect(page.getByLabel('New password')).toBeVisible();

    // Title: required, then saved.
    const title = page.getByLabel('Title', { exact: true });
    await title.fill(' ');
    await submit(page, page.getByRole('button', { name: 'Save the title and welcome' }));
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await title.fill('Ana & Luis');
    await page.getByLabel('Welcome text (optional)').fill('We can’t wait to celebrate with you.');
    await submit(page, page.getByRole('button', { name: 'Save the title and welcome' }));
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    // A text section.
    await addSection(page, 'Text');
    const text = block(page, 'Text');
    await text.getByLabel('Heading').fill('Welcome');
    await text.getByLabel('Text', { exact: true }).fill('Join us by the **lake** in June.');
    await submit(page, text.getByRole('button', { name: 'Save “Text”' }));
    await expect(block(page, 'Welcome')).toBeVisible();

    // A registry: http links are refused on the field, https saved.
    await addSection(page, 'Registry');
    const registry = block(page, 'Registry');
    await registry.getByLabel('Registry 1: name').fill('Our gift list');
    await registry.getByLabel('Registry 1: link').fill('http://gifts.example.test/ana-luis');
    await submit(page, registry.getByRole('button', { name: 'Save “Registry”' }));
    await expect(registry.getByText('Use a full link starting with https://.')).toBeVisible();
    await expect(registry.getByLabel('Registry 1: link')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessibleBothModes(page);
    await registry.getByLabel('Registry 1: link').fill('https://gifts.example.test/ana-luis');
    await submit(page, registry.getByRole('button', { name: 'Save “Registry”' }));
    await expect(registry.getByText('Section saved.')).toBeVisible();
    // A blank second row is ready for the next link.
    await expect(registry.getByLabel('Registry 2: name')).toHaveValue('');

    // An FAQ: an answer is required.
    await addSection(page, 'FAQ');
    const faq = block(page, 'FAQ');
    await faq.getByLabel('Question 1').fill('Can I bring my kids?');
    await submit(page, faq.getByRole('button', { name: 'Save “FAQ”' }));
    await expect(faq.getByText('Fill this in.')).toBeVisible();
    await faq.getByLabel('Answer 1').fill('Yes, of course.');
    await submit(page, faq.getByRole('button', { name: 'Save “FAQ”' }));
    await expect(faq.getByText('Section saved.')).toBeVisible();

    // The program: sub-events everyone is invited to by default; the reception is for Luis only.
    await addSection(page, 'Program');
    const program = block(page, 'Program');
    await expectPicked(program.getByLabel('Which sub-events'), 'everyone');
    await expect(program.getByRole('checkbox', { name: 'Ceremony (everyone is invited)' })).toBeVisible();
    await expect(program.getByRole('checkbox', { name: 'Reception', exact: true })).toBeVisible();

    // Move the program up twice: Welcome, Program, Registry, FAQ.
    await submit(page, page.getByRole('button', { name: 'Move “Program” up' }));
    await expect(blockNames(page)).toHaveText(['Welcome', 'Registry', 'Program', 'FAQ']);
    await submit(page, page.getByRole('button', { name: 'Move “Program” up' }));
    await expect(blockNames(page)).toHaveText(['Welcome', 'Program', 'Registry', 'FAQ']);

    // Publish.
    await submit(page, page.getByRole('button', { name: 'Publish the website' }));
    await expect(
      page.getByText('Published. Share the address and the password with your guests.'),
    ).toBeVisible();
    await expect(page.getByLabel('Website address')).toHaveValue(/\/w\/[0-9A-Z]{8}$/);
    await expectAccessibleBothModes(page);

    // Persisted.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your website' }).locator('..')).toContainText(
      'Published',
    );
    await expect(blockNames(page)).toHaveText(['Welcome', 'Program', 'Registry', 'FAQ']);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Ana & Luis');
    await expect(block(page, 'Registry').getByLabel('Registry 1: link')).toHaveValue(
      'https://gifts.example.test/ana-luis',
    );

    // Remove a section; take the site offline.
    await submit(page, page.getByRole('button', { name: 'Remove “FAQ”' }));
    await expect(blockNames(page)).toHaveText(['Welcome', 'Program', 'Registry']);
    await submit(page, page.getByRole('button', { name: 'Take the website offline' }));
    await expect(page.getByText('The website is offline.')).toBeVisible();
    await expect(page.getByLabel('Website address')).toHaveCount(0);
  });

  test('viewers read the website settings but get no controls', async ({ page }) => {
    const s = await withSite(false);
    await signIn(page, VIEWER);
    await page.goto(editor(s));
    await expect(
      page.getByText('You can see the website here. Only hosts and planners can change it.'),
    ).toBeVisible();
    await expect(blockNames(page)).toHaveText([
      'Welcome',
      'The day',
      'Getting there',
      'Registry',
      'Questions',
    ]);
    for (const name of [
      'Publish the website',
      'Save the password',
      'Save the title and welcome',
      'Add the section',
      'Save “Welcome”',
      'Remove “Welcome”',
    ])
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    await expectAccessibleBothModes(page);
  });

  test('keyboard only: the host adds a section and moves it', async ({ page }) => {
    const s = await withSite(false);
    await signIn(page);
    await page.goto(editor(s));
    const kind = page.getByLabel('Kind of section');
    await kind.focus();
    await pickOption(kind, { label: 'Text' });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add the section' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Section added. Fill it in above.')).toBeVisible();
    await expect(blockNames(page).last()).toHaveText('Text');
    const up = page.getByRole('button', { name: 'Move “Text” up' });
    await up.focus();
    await expect(up).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(blockNames(page)).toHaveText([
      'Welcome',
      'The day',
      'Getting there',
      'Registry',
      'Text',
      'Questions',
    ]);
  });
});

test('the setup guide: "publish your guest website" is a real item that ticks once published', async ({
  page,
}) => {
  const s = await withSite(false);
  await signIn(page);
  await page.goto(`${ORG}/e/${s.eventSlug}/setup-guide`);
  const item = page.locator('[data-rule="guestSitePublished"]');
  await expect(item.getByText('Coming soon')).toHaveCount(0);
  await expect(item).not.toContainText('Done');
  await expect(item.getByRole('link')).toHaveAttribute('href', new RegExp(`/e/${s.eventSlug}/website$`));
  await item.getByRole('link').click();
  await submit(page, page.getByRole('button', { name: 'Publish the website' }));
  await expect(
    page.getByText('Published. Share the address and the password with your guests.'),
  ).toBeVisible();
  await page.goto(`${ORG}/e/${s.eventSlug}/setup-guide`);
  await expect(page.locator('[data-rule="guestSitePublished"]')).toContainText('Done');
});

test.describe('guest website: guests (M4.5a)', () => {
  test('the password gate shows the event name only; the password (any case) opens the site; a reload keeps it open', async ({
    page,
  }) => {
    const s = await withSite();
    await page.goto(`/w/${s.code}`);
    await expect(page).toHaveTitle(/Guest website/);
    await expect(page.getByRole('heading', { name: 'This website is private', level: 1 })).toBeVisible();
    await expect(page.getByText(s.eventName)).toBeVisible();
    // Nothing of the site before the password: not the title, not a block, not a sub-event.
    // (The app's message catalog ships with every page, so generic words are checked on screen.)
    const html = await page.content();
    for (const hidden of [
      'Ana &amp; Luis',
      'Join us by the',
      'gifts.example.test',
      'Lakeside Inn',
      'Can I bring my kids?',
    ])
      expect(html).not.toContain(hidden);
    const shown = await page.locator('main').innerText();
    for (const hidden of ['Welcome', 'Ceremony', 'The garden', 'Registry'])
      expect(shown).not.toContain(hidden);
    await expectAccessibleBothModes(page);

    const open = page.getByRole('button', { name: 'Open the website' });
    await submit(page, open);
    await expect(page.getByText('Enter the password.')).toBeVisible();
    await page.getByLabel('Password').fill('lake houses');
    await submit(page, open);
    await expect(
      page.getByText('That password doesn’t match. Check your invitation and try again.'),
    ).toBeVisible();
    await expect(page.getByLabel('Password')).toBeFocused();
    await expectAccessibleBothModes(page);

    await page.getByLabel('Password').fill('  LAKE house ');
    await open.click();
    await expect(page.getByRole('heading', { name: 'Ana & Luis', level: 1 })).toBeVisible();
    await expect(page.getByText('We can’t wait to celebrate with you.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome', level: 2 })).toBeVisible();
    await expect(page.locator('strong', { hasText: 'lake' })).toBeVisible();
    // The program: the ceremony (everyone), never the reception (Luis only); in Chicago time.
    const program = page.getByRole('region', { name: 'The day' });
    await expect(program.getByRole('heading', { name: 'Ceremony', level: 3 })).toBeVisible();
    await expect(program.getByText('The garden')).toBeVisible();
    await expect(program.getByText(/CST|CDT/)).toBeVisible();
    await expect(page.getByText('Reception')).toHaveCount(0);
    // No guest on the page: no name, no party.
    for (const name of ['Luis López', 'Ana García', 'Mei Chen', 'Garcia family', 'Chen family'])
      await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Website of Lakeside Inn' })).toHaveAttribute(
      'href',
      'https://inn.example.test/',
    );
    const gift = page.getByRole('link', { name: /Our gift list/ });
    await expect(gift).toHaveAttribute('href', 'https://gifts.example.test/ana-luis');
    await expect(gift).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    // The FAQ opens with the keyboard.
    const question = page.getByText('Can I bring my kids?');
    await question.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Yes, of course.')).toBeVisible();
    // "On this page" jumps to each section.
    await page
      .getByRole('navigation', { name: 'On this page' })
      .getByRole('link', { name: 'Questions' })
      .click();
    await expect(page).toHaveURL(/#section-5$/);
    await expectAccessibleBothModes(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Ana & Luis', level: 1 })).toBeVisible();
  });

  test('a new password locks out everyone who used the old one; an unpublished site is not found', async ({
    page,
  }) => {
    const s = await withSite();
    await page.goto(`/w/${s.code}`);
    await page.getByLabel('Password').fill(s.password);
    await page.getByRole('button', { name: 'Open the website' }).click();
    await expect(page.getByRole('heading', { name: 'Ana & Luis', level: 1 })).toBeVisible();
    await executeCommand(
      setGuestSitePasswordCommand,
      { eventId: s.eventId, password: 'Second Pass' },
      createCtx({ orgId: await lakeside(), actor: { type: 'system', name: 'e2e' } }),
      ports,
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'This website is private', level: 1 })).toBeVisible();
    const draft = await withSite(false);
    const res = await page.goto(`/w/${draft.code}`);
    expect(res?.status()).toBe(404);
    expect((await page.goto('/w/ZZZZ2222'))?.status()).toBe(404);
  });

  test('past the limit the human check appears before another try', async ({ page }) => {
    const s = await withSite();
    await page.goto(`/w/${s.code}`);
    const open = page.getByRole('button', { name: 'Open the website' });
    // The device budget is 8 tries in 10 minutes (the address-wide budgets are shared with other
    // tests running in parallel, so the check may come sooner): wrong tries until it appears.
    const challenge = page.getByRole('group', { name: 'One more step' });
    const wrong = page.getByText('That password doesn’t match. Check your invitation and try again.');
    let tries = 0;
    while (!(await challenge.isVisible()) && tries < 12) {
      await page.getByLabel('Password').fill('wrong password');
      await submit(page, open);
      await expect(wrong.or(challenge)).toBeVisible();
      tries++;
    }
    expect(tries).toBeGreaterThan(1);
    await expect(page.getByRole('group', { name: 'One more step' })).toBeVisible();
    await expectAccessibleBothModes(page);
    await passHumanCheck(page);
    await page.getByLabel('Password').fill(s.password);
    await open.click();
    await expect(page.getByRole('heading', { name: 'Ana & Luis', level: 1 })).toBeVisible();
  });

  test('keyboard only: a guest types the password and opens the site with Enter', async ({ page }) => {
    const s = await withSite();
    await page.goto(`/w/${s.code}`);
    await page.getByLabel('Password').focus();
    await page.keyboard.type(s.password);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Ana & Luis', level: 1 })).toBeVisible();
  });

  test('Arabic: the gate and the site render right to left; every language is one link away', async ({
    page,
  }) => {
    const s = await withSite();
    await page.goto(`/ar/w/${s.code}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'هذا الموقع خاص', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByLabel('كلمة المرور').fill(s.password);
    await page.getByRole('button', { name: 'فتح الموقع' }).click();
    await expect(page.getByRole('heading', { name: 'Ana & Luis', level: 1 })).toBeVisible();
    // The hosts' words keep their language; the page's own words are Arabic.
    await expect(page.locator('[lang="en"]').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'اللغات' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'English' })).toHaveAttribute('href', `/en/w/${s.code}`);
    await expectAccessibleBothModes(page);
    // Every locale renders the gate in its own language.
    await page.context().clearCookies();
    for (const [locale, heading] of [
      ['es', 'Este sitio web es privado'],
      ['ja', 'このサイトは非公開です'],
      ['ru', 'Это закрытый сайт'],
    ] as const) {
      await page.goto(`/${locale}/w/${s.code}`);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
  });

  test('never indexed and never on the marketplace', async ({ page, request }) => {
    const s = await withSite();
    // On the marketplace host (public pages there are indexable): this one never is.
    const market = { headers: { host: 'yayatoh.localhost:3100' } };
    const res = await request.get(`/w/${s.code}`, market);
    expect(res.status()).toBe(200);
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await page.goto(`/w/${s.code}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const robots = await (await request.get('/robots.txt', market)).text();
    expect(robots).toContain('Disallow: /w/');
    const sitemap = await (await request.get('/sitemaps/en.xml', market)).text();
    expect(sitemap).not.toContain('/w/');
    const listing = await (await request.get(`/events?q=${encodeURIComponent(s.eventName)}`, market)).text();
    expect(listing).not.toContain(s.eventSlug);
  });
});
