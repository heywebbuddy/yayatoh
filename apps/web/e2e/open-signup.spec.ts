import { expect, type Page, test } from '@playwright/test';
import {
  codeForKey,
  expectAccessible,
  lastEmailedCode,
  ownClientIp,
  passHumanCheck,
  pickOption,
  withOpenSignup,
} from './helpers.ts';

/**
 * Self-serve signup (M3.11a). The switch is platform-wide and off until the owner launches:
 * each test takes the shared lock and sets the state it needs (then closes it again).
 */
test.describe('self-serve signup', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('closed (the default): coming soon, a code box that works by keyboard, no form; Arabic RTL', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withOpenSignup(false, async () => {
      await page.goto('/signup');
      await expect(page.getByRole('heading', { name: 'Self-serve signup is coming soon' })).toBeVisible();
      await expect(page.getByText('You need a signup code')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create organization' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'See pricing and fees' })).toHaveAttribute(
        'href',
        '/pricing',
      );
      await expectAccessible(page);
      // Keyboard: type a code and submit it with Enter.
      await page.getByLabel('Signup code').focus();
      await page.keyboard.type('YY-NOPE-NOPE-NOPE');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/signup\?code=YY-NOPE-NOPE-NOPE$/);
      await expect(page.getByText("This signup code isn't valid")).toBeVisible();

      await page.goto('/ar/signup');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { name: 'التسجيل الذاتي متاح قريبًا' })).toBeVisible();
      await expectAccessible(page);
    });
  });

  test('open: a newcomer verifies their email, creates an org in setup mode and finishes the onboarding checklist', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await ownClientIp(page.context());
    const stamp = Date.now();
    const email = `founder-${stamp}@newcomer.test`;
    const slug = `night-market-${stamp}`;
    await withOpenSignup(true, async () => {
      await page.goto('/signup');
      await expect(page.getByText('Create your organizer account and your organization')).toBeVisible();
      // Email verification first: an emailed one-time code creates and verifies the account.
      await page.getByRole('link', { name: 'Continue with email' }).click();
      await expect(page).toHaveURL(/\/sign-in\?next=%2Fsignup/);
      await page.getByRole('button', { name: 'Use a one-time code instead' }).click();
      await page.getByLabel('Email', { exact: true }).fill(email);
      // M1.2f (base): an emailed code, which can create an account, needs the person check.
      await passHumanCheck(page);
      await page.getByRole('button', { name: 'Email me a code' }).click();
      await page.getByLabel('6-digit code', { exact: true }).fill(await lastEmailedCode(page, email));
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      await expect(page).toHaveURL(/\/signup$/);

      // No code field; the terms and the person check are required.
      await expect(page.getByLabel('Signup code')).toHaveCount(0);
      await expect(page.getByText(/starts in setup mode/)).toBeVisible();
      await expectAccessible(page);
      await page.getByLabel('Organization name').fill(`Night Market ${stamp}`);
      await expect(page.getByLabel('Web address')).toHaveValue(slug);
      await page.getByRole('radio', { name: /Concert/ }).check();
      await page.getByLabel(/I agree to the Terms of Service/).check();
      await page.getByRole('button', { name: 'Create organization' }).click();
      await expect(page.getByText("Please confirm you're a person.")).toBeVisible();
      await page.getByLabel("I'm a person (test check)").check();
      await page.getByLabel(/I agree to the Terms of Service/).check();
      // Keyboard submit.
      await page.getByRole('button', { name: 'Create organization' }).focus();
      await page.keyboard.press('Enter');
      // A new owner sets up two-step verification before the console opens (M1.2c).
      await expect(page).toHaveURL(/\/account\/security\?required=1$/);
    });
    await setUpTwoFactor(page);
    await page.goto(`/o/${slug}`);

    // The org home: setup mode with the required steps, and the checklist deep links.
    const setup = page.getByRole('region', { name: /Get ready to sell/ });
    await expect(setup.getByText('Your organization is in setup mode')).toBeVisible();
    const required = setup.getByRole('list', { name: 'Required steps' });
    await expect(required.getByText('Accept the terms of service')).toHaveClass(/line-through/);
    await expect(required.getByRole('link', { name: 'Publish a privacy notice' })).toHaveAttribute(
      'href',
      `/o/${slug}/settings#legal-privacy`,
    );
    await expect(setup.getByRole('link', { name: 'Choose your brand colour' })).toHaveAttribute(
      'href',
      `/o/${slug}/settings#brand-heading`,
    );
    await expect(setup.getByRole('link', { name: 'Invite a teammate' })).toHaveAttribute(
      'href',
      `/o/${slug}/team`,
    );
    await expect(setup.getByRole('button', { name: 'Finish setup' })).toHaveCount(0);
    await expectAccessible(page);

    // Arabic RTL: the same checklist, mirrored (its own tab, so this one keeps English).
    const arabic = await (
      await browser.newContext({ storageState: await page.context().storageState() })
    ).newPage();
    await arabic.goto(`/ar/o/${slug}`);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.getByText('مؤسستك في وضع الإعداد')).toBeVisible();
    await expectAccessible(arabic);
    await arabic.context().close();

    // Privacy notice, through the deep link.
    await page.goto(`/o/${slug}`);
    await required.getByRole('link', { name: 'Publish a privacy notice' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/settings#legal-privacy$`));
    const legal = page.getByRole('region', { name: 'Your legal pages' });
    await legal.getByLabel('Privacy notice').fill(`We use guest details only to run our events. (${stamp})`);
    await legal.getByRole('button', { name: 'Save' }).nth(1).click();
    await expect(legal.getByText('Saved.')).toBeVisible();

    // First event, through the deep link.
    await page.goto(`/o/${slug}`);
    await required.getByRole('link', { name: 'Create your first event' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/events/new/guided$`));
    await createDraftEvent(page, slug, `Opening Night ${stamp}`);

    // Progress persisted: the required steps are done; finish setup by keyboard.
    await page.goto(`/o/${slug}`);
    await expect(required.getByText('Publish a privacy notice')).toHaveClass(/line-through/);
    await expect(required.getByText('Create your first event')).toHaveClass(/line-through/);
    await expect(setup.getByText('Create your first event').last()).toHaveClass(/line-through/);
    await setup.getByRole('button', { name: 'Finish setup' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Setup complete. Your organization is fully active.')).toBeVisible();
    await expect(page.getByText('Your organization is in setup mode')).toHaveCount(0);
    await expectAccessible(page);
  });
});

/** Two-step verification with an authenticator app, as the owner's role requires. */
async function setUpTwoFactor(page: Page) {
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const key = (await page.getByTestId('setup-key').textContent()) ?? '';
  await page.getByLabel('6-digit code').fill(codeForKey(key));
  await page.getByRole('button', { name: 'Verify and turn on' }).click();
  await page.getByRole('button', { name: "I've saved my codes" }).click();
}

/** A draft event through the plain form (the guided wizard's first step links to it). */
async function createDraftEvent(page: Page, slug: string, name: string) {
  await page.goto(`/o/${slug}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'concert');
  await page.getByLabel('Starts', { exact: true }).fill('2031-05-01T19:00');
  await page.getByLabel('Ends', { exact: true }).fill('2031-05-01T23:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/e/[a-z0-9-]+$`));
}
