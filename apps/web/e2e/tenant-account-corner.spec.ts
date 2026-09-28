import { expect, type Page, test } from '@playwright/test';
import { devPassword, expectAccessible, newUser, ownClientIp } from './helpers.ts';

/**
 * The account corner on a tenant site's event pages (M1.2f): signed out, "Sign in" goes through
 * the app host and comes back to the same event; signed in, the person sees who they are, their
 * tickets at this organizer and (members of this org only) its console. Nothing about other
 * organizers shows.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const APP = `http://localhost:${PORT}`;
const site = (slug: string) => `http://${slug}.yayatoh.events:${PORT}`;

interface Published {
  readonly email: string;
  readonly orgSlug: string;
  readonly eventSlug: string;
}

/** A fresh org owner (signed in on the app host) with a published event on its tenant site. */
async function publishedOrg(page: Page): Promise<Published> {
  const form = new URLSearchParams({ org: 'new', twoFactor: '1', event: 'published' });
  const res = await page.request.post('/api/dev/user', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as Published;
}

const corner = (page: Page) => page.getByRole('navigation', { name: 'Your account' });

async function signInThroughAppHost(page: Page, email: string) {
  await expect(page).toHaveURL(new RegExp(`^${APP}/(ar/)?sign-in\\?return=`));
  await page.waitForLoadState('load');
  await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(email);
  await page.getByLabel(/^(Password|كلمة المرور)$/).fill(devPassword());
  await page.getByLabel(/^(Password|كلمة المرور)$/).press('Enter');
}

test.describe('tenant event page account corner (M1.2f)', () => {
  test('signed out → Sign in through the app host → back on the event, with Your tickets and no console link', async ({
    browser,
  }) => {
    const ownerPage = await (await browser.newContext({ baseURL: APP })).newPage();
    const org = await publishedOrg(ownerPage);
    await ownerPage.context().close();
    const event = `${site(org.orgSlug)}/events/${org.eventSlug}`;

    const context = await browser.newContext({ baseURL: APP });
    await ownClientIp(context);
    const page = await context.newPage();
    const name = `Aria ${test.info().project.name.split('-')[0]} ${Date.now()}`;
    const buyer = await newUser(page, { signIn: false, name });

    await page.goto(event);
    const signIn = page.getByRole('link', { name: 'Sign in', exact: true });
    await expect(signIn).toBeVisible();
    await expectAccessible(page);
    await signIn.focus();
    await page.keyboard.press('Enter');
    await signInThroughAppHost(page, buyer.email);
    await expect(page).toHaveURL(event);
    await expect(corner(page)).toContainText(`Signed in as ${name}`);
    await expect(corner(page).getByRole('link', { name: 'Your tickets' })).toBeVisible();
    // Not a member of this organizer: no console link.
    await expect(corner(page).getByRole('link', { name: 'Organizer console' })).toHaveCount(0);
    await expectAccessible(page);

    // Your tickets: empty, then the free pass bought while signed in on this site.
    await corner(page).getByRole('link', { name: 'Your tickets' }).click();
    await expect(page).toHaveURL(`${site(org.orgSlug)}/tickets`);
    await expect(page.getByRole('heading', { name: 'Your tickets', level: 1 })).toBeVisible();
    await expect(page.getByText('No tickets yet')).toBeVisible();
    await expectAccessible(page);
    await page.goto(event);
    await page.getByLabel('Quantity — Free entry').selectOption('1');
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Email for your tickets').fill(buyer.email);
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    await page.goto(`${site(org.orgSlug)}/tickets`);
    const row = page.getByRole('listitem').filter({ hasText: /Test Show/ });
    await expect(row).toContainText('Paid');
    await expect(row.getByRole('link', { name: /^View order for Test Show/ })).toBeVisible();
    await expectAccessible(page);

    // Signing out on the site ends only its session.
    await page.goto(event);
    await corner(page).getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto(`${site(org.orgSlug)}/tickets`);
    await expect(page.getByText(/^Sign in to see the tickets you bought from/)).toBeVisible();
    await context.close();
  });

  test('a member of the org sees its console link; on another organizer’s site they don’t', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: APP });
    await ownClientIp(context);
    const page = await context.newPage();
    // The owner is signed in on the app host already (the dev tool signed them in).
    const org = await publishedOrg(page);
    await page.goto(`${site(org.orgSlug)}/events/${org.eventSlug}`);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: `Continue to ${org.orgSlug}.yayatoh.events` }).click();
    await expect(page).toHaveURL(`${site(org.orgSlug)}/events/${org.eventSlug}`);
    const console = corner(page).getByRole('link', { name: 'Organizer console' });
    await expect(console).toBeVisible();
    await expect(console).toHaveAttribute('href', `${APP}/o/${org.orgSlug}`);

    // On another organizer's site (harbor-arts), the same person is not a member there.
    await page.goto(`${site('harbor-arts')}/`);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to harbor-arts.yayatoh.events' }).click();
    await expect(page).toHaveURL(`${site('harbor-arts')}/`);
    await expect(corner(page)).toContainText('Signed in as');
    await expect(corner(page).getByRole('link', { name: 'Organizer console' })).toHaveCount(0);
    // And the tickets page there lists nothing of the other organizer.
    await page.goto(`${site('harbor-arts')}/tickets`);
    await expect(page.getByText('No tickets yet')).toBeVisible();
    await context.close();
  });

  test('the corner in Arabic reads right to left', async ({ browser }) => {
    const ownerPage = await (await browser.newContext({ baseURL: APP })).newPage();
    const org = await publishedOrg(ownerPage);
    await ownerPage.context().close();
    const context = await browser.newContext({ baseURL: APP });
    await ownClientIp(context);
    const page = await context.newPage();
    const buyer = await newUser(page, { signIn: false, name: 'Rami Test' });
    await page.goto(`${site(org.orgSlug)}/ar/events/${org.eventSlug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('link', { name: 'تسجيل الدخول', exact: true }).click();
    await signInThroughAppHost(page, buyer.email);
    await expect(page).toHaveURL(`${site(org.orgSlug)}/ar/events/${org.eventSlug}`);
    await expect(page.getByRole('navigation', { name: 'حسابك' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'تذاكرك' })).toBeVisible();
    await expectAccessible(page);
    await context.close();
  });
});
