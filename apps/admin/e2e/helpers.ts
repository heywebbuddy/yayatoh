import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page } from '@playwright/test';

export const WEB_PORT = Number(process.env.E2E_PORT ?? 3100);
export const WEB = `http://localhost:${WEB_PORT}`;
/** The marketplace host (`*.localhost` resolves to the web server). */
export const MARKET = `http://yayatoh.localhost:${WEB_PORT}`;
/** An org's managed tenant site (mapped to the web server in playwright.config.ts). */
export const tenantSite = (slug: string) => `http://${slug}.yayatoh.events:${WEB_PORT}`;
export const STAFF = 'omar@yayatoh.test';

export function devPassword(): string {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!password) throw new Error('DEV_PERSONA_PASSWORD is not set');
  return password;
}

/** Sign-in is rate limited per client IP: each test acts as its own client, as real staff do. */
export async function ownClientIp(page: Page) {
  const n = Math.floor(Math.random() * 0xffffff);
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `10.${n >> 16}.${(n >> 8) & 255}.${n & 255}` });
}

/** Staff sign in to the console with their existing account (no second step for the persona). */
export async function signInStaff(page: Page, email = STAFF) {
  await ownClientIp(page);
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(devPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/sign-in$/);
}

export async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))).toEqual(
    [],
  );
}

export interface WebUser {
  readonly email: string;
  readonly orgSlug: string | null;
  readonly eventSlug: string | null;
}

/**
 * A throwaway account on the web app (dev only, `/api/dev/user`), signed in on `page`'s context.
 * `org` makes it the owner of a new org (two-step verification on, as owners need); `event` also
 * publishes a listed event there; `join` adds it to an existing org (`slug:role`); `name` sets
 * the account's name.
 */
export async function webUser(
  page: Page,
  opts: {
    org?: boolean;
    event?: boolean;
    join?: string;
    signIn?: boolean;
    twoFactor?: boolean;
    name?: string;
  } = {},
): Promise<WebUser> {
  const form = new URLSearchParams();
  if (opts.org) {
    form.set('org', 'new');
    form.set('twoFactor', '1');
  }
  if (opts.twoFactor) form.set('twoFactor', '1');
  if (opts.event) form.set('event', 'published');
  if (opts.join) form.set('join', opts.join);
  if (opts.signIn === false) form.set('signIn', '0');
  if (opts.name) form.set('name', opts.name);
  const res = await page.request.post(`${WEB}/api/dev/user`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as WebUser;
}

/** A fresh browser context on the web app with its own client IP. */
export async function webPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: WEB })).newPage();
  await ownClientIp(page);
  return page;
}

/** Make an account staff with a role through the worker CLI (the owner-approved path). */
export function makeStaff(email: string, role: 'admin' | 'support' | 'finance') {
  execFileSync('node', ['scripts/staff.ts', '--email', email, '--role', role, '--by', 'staff:e2e'], {
    cwd: fileURLToPath(new URL('../../worker/', import.meta.url)),
    env: process.env,
  });
}

/** Open a tenant in the console by searching for its address. */
export async function openTenant(page: Page, slug: string, name: string) {
  await page.goto(`/?q=${encodeURIComponent(slug)}`);
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/**
 * Replay a console form another person was shown (its server action and bound arguments) as the
 * current page's session, with native submission: what a crafted request from someone without
 * the control would do.
 */
export async function replayForm(page: Page, html: string, fields: Record<string, string> = {}) {
  await page.evaluate(
    ({ html, fields }) => {
      const box = document.createElement('div');
      box.innerHTML = html;
      document.body.append(box);
      const form = box.querySelector('form') as HTMLFormElement;
      for (const [name, value] of Object.entries(fields)) {
        const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) continue;
        if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = value === 'yes';
        else el.value = value;
      }
      HTMLFormElement.prototype.submit.call(form);
    },
    { html, fields },
  );
  await page.waitForLoadState('load');
}

/**
 * A console form exactly as the server rendered it for this page's session (with its action and
 * bound arguments as hidden fields), by its accessible name. Hydrated forms lose those fields.
 */
export async function serverForm(page: Page, label: string): Promise<string> {
  const html = await (await page.request.get(page.url())).text();
  return page.evaluate(
    ({ html, label }) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const form = [...doc.querySelectorAll('form')].find((f) => f.getAttribute('aria-label') === label);
      if (!form) throw new Error(`no form "${label}"`);
      return form.outerHTML;
    },
    { html, label },
  );
}

/**
 * A guest on the web app continues from the ticket form and proves the email with the code
 * the dev mailbox received (M1.5f: guest checkout verifies the buyer's email).
 */
export async function continueToPayment(guest: Page, email: string) {
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  const field = guest.getByLabel('Verification code', { exact: true });
  await expect(field).toBeVisible();
  let code: string | null = null;
  await expect
    .poll(async () => {
      const res = await guest.request.get(`${WEB}/api/dev/last-code?to=${encodeURIComponent(email)}`);
      code = ((await res.json()) as { code: string | null }).code;
      return code;
    })
    .toMatch(/^\d{6}$/);
  await field.fill(code ?? '');
  await guest.getByRole('button', { name: 'Verify and continue' }).click();
}
