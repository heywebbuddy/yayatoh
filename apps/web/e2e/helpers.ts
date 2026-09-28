import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page } from '@playwright/test';
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

/** The current authenticator code for a setup key, as an app would show it. */
export const codeForKey = (setupKey: string) => totp(base32Decode(setupKey), Date.now());

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
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
  ).toEqual([]);
}

/** axe on a standalone HTML document (e.g. an email), loaded into a fresh page of the context. */
export async function expectHtmlAccessible(page: Page, html: string) {
  const doc = await page.context().newPage();
  await doc.setContent(html);
  await expectAccessible(doc);
  await doc.close();
}
