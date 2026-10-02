import { execFileSync } from 'node:child_process';
import { closeSync, openSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { base32Decode, devPersonaTotpSecret, secretKey, totp } from '@yayatoh/auth/totp';

export const OWNER = 'pani@lakeside.test';
export const WEDDING_OWNER = 'maya@rosewood.test';
export const EVENT = '/o/lakeside-events/e/midwest-leadership-summit-2027';
/** A plain event (no demo overlay) for flows that create real orders and attendees. */
export const OPEN_HOUSE = '/o/lakeside-events/e/lakeside-open-house';
export const WEDDING = '/o/rosewood-weddings/e/harper-and-theo';

/**
 * Signs a seeded persona in through the dev login: a real password sign-in, and for personas with
 * two-step verification (the owners, M1.2c) the real challenge answered with their dev-only secret.
 */
export async function signIn(page: Page, email = OWNER) {
  const res = await page.request.post('/api/dev/login', { form: { email, locale: 'en' }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
}

/**
 * Sign-in routes are rate limited per client IP (10 a minute). Tests that sign in through the
 * form run in parallel from one machine, so each acts as its own client, like real people do.
 */
export async function ownClientIp(context: BrowserContext) {
  const n = Math.floor(Math.random() * 0xffffff);
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${n >> 16}.${(n >> 8) & 255}.${n & 255}` });
}

/** The dev-only persona password (seeded users and throwaway users share it). */
export function devPassword(): string {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!password) throw new Error('DEV_PERSONA_PASSWORD is not set');
  return password;
}

/** The current authenticator code of a seeded persona with two-step verification (dev secret). */
export const personaCode = (email = OWNER) =>
  totp(secretKey(devPersonaTotpSecret(email, devPassword())), Date.now());

/** The authenticator code for a setup key (now, or at `at`), as an app would show it. */
export const codeForKey = (setupKey: string, at = Date.now()) => totp(base32Decode(setupKey), at);

/** A code that is certainly wrong right now (not the current one, nor one step either side). */
export function wrongCode(right: (at: number) => string): string {
  const near = new Set([-30_000, 0, 30_000].map((d) => right(Date.now() + d)));
  for (const c of ['000000', '111111', '222222', '333333']) if (!near.has(c)) return c;
  return '444444';
}

export interface TestUser {
  readonly email: string;
  readonly orgSlug: string | null;
  readonly setupKey: string | null;
  readonly backupCodes: readonly string[];
}

/**
 * A throwaway account (dev only, `/api/dev/user`), signed in on `page` unless `signIn: false`.
 * `org: true` makes it the owner of a new organization; `join` adds it to seeded ones
 * (`lakeside-events:viewer`); `twoFactor` turns two-step verification on; `password: false`
 * leaves it without a password (it signs in with emailed codes).
 */
export async function newUser(
  page: Page,
  opts: {
    org?: boolean;
    join?: string[];
    twoFactor?: boolean;
    password?: boolean;
    signIn?: boolean;
    name?: string;
    /** With `org`: terms accepted and one published event (see /api/dev/user `event=published`). */
    event?: 'published';
  } = {},
): Promise<TestUser> {
  const form = new URLSearchParams();
  if (opts.org) form.set('org', 'new');
  for (const j of opts.join ?? []) form.append('join', j);
  if (opts.twoFactor) form.set('twoFactor', '1');
  if (opts.password === false) form.set('password', '0');
  if (opts.signIn === false) form.set('signIn', '0');
  if (opts.name) form.set('name', opts.name);
  if (opts.event) form.set('event', opts.event);
  const res = await page.request.post('/api/dev/user', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as TestUser;
}

/** Ages this session past the 10-minute step-up window (dev only), as if signed in long ago. */
export async function ageSession(page: Page, minutes = 11) {
  const res = await page.request.post('/api/dev/session/age', { form: { minutes: String(minutes) } });
  expect(res.status()).toBe(204);
}

/** The last one-time code "emailed" to an address (dev only). */
export async function lastEmailedCode(page: Page, email: string): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/dev/last-code?to=${encodeURIComponent(email)}`);
      code = ((await res.json()) as { code: string | null }).code;
      return code;
    })
    .toMatch(/^\d{6}$/);
  return code ?? '';
}

/** Ticks the fake "are you a person?" check (M1.2f; Turnstile's stand-in in dev and CI). */
export async function passHumanCheck(page: Page) {
  await page.getByRole('checkbox', { name: "I'm a person (test check)" }).check();
}

/** The "Confirm it's you" dialog. */
export const stepUpDialog = (page: Page) => page.getByRole('dialog', { name: "Confirm it's you" });

/** Answers "Confirm it's you" with an authenticator (or backup) code and waits for it to close. */
export async function confirmStepUp(page: Page, code: string) {
  const dialog = stepUpDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Code').fill(code);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);
}

/** axe: zero serious or critical violations (WCAG 2.2 AA tags). */
export async function expectAccessible(page: Page) {
  // After a Server Action re-render, Next streams metadata back in: wait for the title (a page
  // without one still fails here) so axe never judges that in-between moment.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Fully sandboxed frames (email previews) run no scripts, so axe can't enter them and may
    // hang waiting; their documents are checked on their own with expectHtmlAccessible.
    .exclude('iframe[sandbox=""]')
    .analyze();
  await attachAxeSummary(results);
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

/**
 * axe in light AND dark mode (ADR 0022): checks the page as served, then switches <html> to the
 * dark theme in place (exactly what the theme switch does) and checks again, then restores it.
 */
export async function expectAccessibleBothModes(page: Page) {
  const html = page.locator('html');
  const before = (await html.getAttribute('data-theme')) ?? 'light';
  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate((m) => {
      document.documentElement.dataset.theme = m;
    }, mode);
    await expect(html).toHaveAttribute('data-theme', mode);
    await expectAccessible(page);
  }
  await page.evaluate((m) => {
    document.documentElement.dataset.theme = m;
  }, before);
}

type AxeRun = Awaited<ReturnType<AxeBuilder['analyze']>>;

/**
 * M5.11a: every axe run is attached to the test as `axe-summary` (rule ids, WCAG tags, impact
 * and node counts only: no selectors, URLs or page text), so the evidence workflow can build the
 * VPAT draft from the e2e shards' JSON reports.
 */
async function attachAxeSummary(r: AxeRun) {
  const rule = (x: AxeRun['violations'][number]) => ({
    id: x.id,
    tags: x.tags,
    impact: x.impact ?? null,
    nodes: x.nodes.length,
  });
  const body = JSON.stringify({
    passes: r.passes.map((x) => ({ id: x.id, tags: x.tags, nodes: x.nodes.length })),
    violations: r.violations.map(rule),
    incomplete: r.incomplete.map(rule),
  });
  await test.info().attach('axe-summary', { body, contentType: 'application/json' });
}

/** axe on a standalone HTML document (e.g. an email), loaded into a fresh page of the context. */
export async function expectHtmlAccessible(page: Page, html: string) {
  const doc = await page.context().newPage();
  await doc.setContent(html);
  await expectAccessible(doc);
  await doc.close();
}

/**
 * M1.5f: checkout's buyer email step. Clicks "Continue to payment", then (unless this browser
 * already proved the address, `verify: false`) enters the 6-digit code the dev mailbox received
 * (`/api/dev/last-code`) and chooses "Verify and continue". Afterwards the page is wherever
 * checkout goes next (the order, the payment page or an error), exactly as before verification.
 */
export async function continueToPayment(page: Page, email: string, opts: { verify?: boolean } = {}) {
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  if (opts.verify === false) return;
  await verifyCheckoutEmail(page, email);
}

/** Enter the emailed checkout code (the code step must be showing or about to show). */
export async function verifyCheckoutEmail(page: Page, email: string) {
  const field = page.getByLabel('Verification code', { exact: true });
  await expect(field).toBeVisible();
  await field.fill(await lastEmailedCode(page, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
}

const SIGNUP_LOCK = join(tmpdir(), 'yayatoh-open-signup.lock');

/** Flip the platform-wide open-signup switch through the staff CLI (M3.11a; audited). */
export function setOpenSignup(open: boolean) {
  execFileSync(
    'node',
    ['scripts/open-signup.ts', open ? '--on' : '--off', '--reason', 'e2e run', '--by', 'staff:e2e'],
    { cwd: fileURLToPath(new URL('../../worker/', import.meta.url)), env: process.env },
  );
}

/**
 * Run `fn` with open signup switched `open`, then closed again. The switch is platform-wide, so
 * tests that depend on it (here and in the staff console suite) take turns through a lock file;
 * a lock older than five minutes is from a crashed run and is taken over.
 */
export async function withOpenSignup<T>(open: boolean, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 240_000;
  for (;;) {
    try {
      closeSync(openSync(SIGNUP_LOCK, 'wx'));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(SIGNUP_LOCK).mtimeMs > 300_000) unlinkSync(SIGNUP_LOCK);
      } catch {}
      if (Date.now() > deadline) throw new Error('timed out waiting for the open-signup lock');
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    setOpenSignup(open);
    return await fn();
  } finally {
    try {
      setOpenSignup(false);
    } finally {
      unlinkSync(SIGNUP_LOCK);
    }
  }
}
