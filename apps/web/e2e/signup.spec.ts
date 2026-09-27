import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/** A fresh one-use code from the staff CLI (the worker, which may use the platform role). */
function signupCode(): string {
  const out = execFileSync('node', ['scripts/signup-code.ts', '--json', '--note', 'e2e'], {
    cwd: fileURLToPath(new URL('../../worker/', import.meta.url)),
    env: process.env,
  }).toString();
  return (JSON.parse(out.trim().split('\n').pop() ?? '{}') as { code: string }).code;
}

test.describe('invite-only signup', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('without a valid code there is no form; with one, a signed-in person creates an organization', async ({
    page,
  }) => {
    await page.goto('/signup');
    await expect(page.getByText('You need a signup code')).toBeVisible();
    await page.goto('/signup?code=YY-NOPE-NOPE-NOPE');
    await expect(page.getByText("This signup code isn't valid")).toBeVisible();

    const code = signupCode();
    await page.goto(`/signup?code=${code}`);
    await expect(page.getByRole('link', { name: 'Continue with email' })).toBeVisible();
    // A newcomer with no organization yet (the seeded owners' home pages stay as they are).
    await signIn(page, 'nia@newcomer.test');
    await page.goto(`/signup?code=${code}`);
    await expectAccessible(page);
    const stamp = Date.now();
    await page.getByLabel('Organization name').fill(`Harbor Weddings ${stamp}`);
    await expect(page.getByLabel('Web address')).toHaveValue(`harbor-weddings-${stamp}`);
    await page.getByRole('radio', { name: /Wedding/ }).check();
    await page.getByLabel(/I agree to the Terms of Service/).check();
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/harbor-weddings-${stamp}$`));
    // The code was single-use.
    await page.goto(`/signup?code=${code}`);
    await expect(page.getByText("This signup code isn't valid")).toBeVisible();
  });

  test('password sign-up over HTTP is closed', async ({ request }) => {
    const res = await request.post('/api/auth/sign-up/email', {
      data: { email: `x${Date.now()}@example.test`, password: 'long-enough-pass', name: 'X' },
    });
    expect(res.status()).toBe(403);
  });
});
