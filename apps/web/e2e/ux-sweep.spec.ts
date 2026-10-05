import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { LOCALES } from '@yayatoh/contracts';
import { setThemeSettled, signIn } from './helpers.ts';
import { axeSerious, measure, type PageMetrics } from './ux-sweep/checks.ts';
import {
  EVENT,
  EXCLUDED,
  EXCLUDED_ADMIN,
  matchTemplate,
  NO_FOLLOW,
  ORG,
  REPO,
  type Template,
  templates,
} from './ux-sweep/routes.ts';

/**
 * U11 whole-app UX sweep (docs/plans/ux-review-1.md). Runs as its own project (`ux-sweep`, see
 * playwright.config.ts): `UX_SWEEP=1 pnpm --filter @yayatoh/web exec playwright test --project=ux-sweep`.
 *
 * 1. discover: walks every console, admin and public page template (links from the seeded pages,
 *    seeds for the params we know) and screenshots it at 1440 px in both themes;
 * 2. 1024 and 390 px: the same routes again (axe in both themes at 1024 px);
 * 3. coverage: every `page.tsx` in apps/web and apps/admin is visited or excluded with a reason.
 *
 * The screenshots and per-page metrics land in docs/ux/sweep/ (full-size images stay out of git; the
 * contact sheets, routes.json and findings.json are committed by tools/ux-sweep).
 */
const WEB_PORT = Number(process.env.E2E_PORT ?? 3100);
const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT ?? 3101);
const WEB = `http://localhost:${WEB_PORT}`;
const ADMIN = `http://localhost:${ADMIN_PORT}`;
const OUT = join(REPO, 'docs/ux/sweep');
const FULL = join(OUT, 'full');
const ROUTES = join(OUT, 'routes.json');
const FINDINGS = join(OUT, 'findings.json');
const DEAD = join(OUT, 'dead-links.json');
const CANARY = new URL('./.generated/canary.json', import.meta.url);
const WIDTHS = [1440, 1024, 390] as const;
const THEMES = ['light', 'dark'] as const;
const LOCALE_SET = new Set<string>(LOCALES);
const MAX_SHOT_HEIGHT = 2600;

type App = 'web' | 'admin';
interface Route {
  app: App;
  /** Who sees it: the organizer personas, an agency, a visitor or staff (admin). */
  actor: ActorKey;
  pattern: string;
  /** Path as visited (no locale for web; `/en` is added). */
  path: string;
  status: number;
  /** Where the visit ended when it was redirected away from the template. */
  redirectedTo?: string;
}
interface Finding {
  app: App;
  pattern: string;
  width: number;
  metrics: PageMetrics;
  axe?: Record<
    (typeof THEMES)[number],
    { id: string; impact: string | null | undefined; nodes: number; sample: string }[]
  >;
  consoleErrors: string[];
}

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'ux-sweep', 'the sweep is its own project');
});
test.describe.configure({ mode: 'serial' });

const slug = (app: App, p: string) => `${app}${p === '/' ? '-home' : p.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const only = process.env.UX_SWEEP_ONLY ? new RegExp(process.env.UX_SWEEP_ONLY) : null;

function stripLocale(path: string): string {
  const [, first, ...rest] = path.split('/');
  return first && LOCALE_SET.has(first) ? `/${rest.join('/')}` : path;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  // Waits for the colour fades the switch starts (axe and screenshots see the settled theme).
  await setThemeSettled(page, theme);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

function urlFor(app: App, path: string): string {
  if (app === 'admin') return `${ADMIN}${path}`;
  // A tenant's managed site is served on its own host (`/t/{org}/…` is the internal path).
  const tenant = /^\/t\/([^/]+)(\/.*)?$/.exec(path);
  if (tenant) return `http://${tenant[1]}.yayatoh.events:${WEB_PORT}${tenant[2] ?? '/'}`;
  return `${WEB}/en${path === '/' ? '' : path}`;
}

async function signInStaff(page: Page) {
  const n = Math.floor(Math.random() * 0xffffff);
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `10.${n >> 16}.${(n >> 8) & 255}.${n & 255}` });
  await page.goto(`${ADMIN}/sign-in`);
  await page.getByLabel('Email', { exact: true }).fill('omar@yayatoh.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEV_PERSONA_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in$/);
}

type ActorKey = 'owner' | 'wedding' | 'harbor' | 'agency' | 'visitor' | 'staff';
interface Actor {
  readonly key: ActorKey;
  readonly org: string;
  readonly events: readonly string[];
}
/** The seeded organizers (a conference, a wedding, the platform content org) and a throwaway agency. */
const ACTORS: Actor[] = [
  { key: 'owner', org: ORG, events: [EVENT, 'lakeside-jazz-night', 'lakeside-open-house'] },
  { key: 'wedding', org: 'rosewood-weddings', events: ['harper-and-theo'] },
  { key: 'harbor', org: 'harbor-arts', events: ['harbor-film-night', 'harbor-spring-concert'] },
  { key: 'agency', org: '', events: [] },
];
const EMAIL: Partial<Record<ActorKey, string>> = {
  owner: 'pani@lakeside.test',
  wedding: 'maya@rosewood.test',
  harbor: 'lee@harbor.test',
};

async function contexts(browser: import('@playwright/test').Browser) {
  const make = async (key: ActorKey) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    if (key === 'staff') await signInStaff(page);
    else if (key === 'agency') {
      const form = new URLSearchParams({
        org: 'agency',
        orgName: `Sweep agency ${Date.now()}`,
        twoFactor: '1',
      });
      const res = await page.request.post('/api/dev/user', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: form.toString(),
      });
      const user = (await res.json()) as { orgSlug: string };
      const actor = ACTORS.find((a) => a.key === 'agency');
      if (actor) (actor as { org: string }).org = user.orgSlug;
    } else if (key !== 'visitor') await signIn(page, EMAIL[key]);
    return { context, page };
  };
  const out = {} as Record<ActorKey, { context: BrowserContext; page: Page }>;
  for (const key of ['owner', 'wedding', 'harbor', 'agency', 'visitor', 'staff'] as const)
    out[key] = await make(key);
  return out;
}
type Ctxs = Awaited<ReturnType<typeof contexts>>;
const pick = (c: Ctxs, r: { actor: ActorKey }) => c[r.actor];
const closeAll = (c: Ctxs) => Promise.all(Object.values(c).map((x) => x.context.close()));

/** Every way to fill a template from the seeded actors: [path, actor]. */
function candidates(pattern: string): { path: string; actor: ActorKey }[] {
  const out: { path: string; actor: ActorKey }[] = [];
  const fillWith = (org: string, event: string | null): string | null => {
    let ok = true;
    const p = pattern.replace(/\[(\w+)\]/g, (_m, name: string) => {
      if (name === 'org') return org;
      if (name === 'event' && event) return event;
      if (name === 'slug' && pattern.startsWith('/events/') && event) return event;
      if (name === 'slug' && pattern.startsWith('/organizers/')) return org;
      ok = false;
      return '';
    });
    return ok ? p : null;
  };
  const consoleRoute = pattern.startsWith('/o/[org]');
  for (const a of ACTORS) {
    for (const ev of a.events.length ? a.events : [null]) {
      const path = fillWith(a.org, ev);
      if (path) out.push({ path, actor: consoleRoute ? a.key : 'visitor' });
      if (!ev) break;
    }
  }
  return [...new Map(out.map((x) => [`${x.actor}:${x.path}`, x])).values()];
}

async function visit(page: Page, app: App, path: string) {
  const errors: string[] = [];
  const onConsole = (m: import('@playwright/test').ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  };
  const onPageError = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 160)}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const res = await page.goto(urlFor(app, path), { waitUntil: 'load', timeout: 45_000 }).catch(() => null);
  await settle(page);
  return {
    status: res?.status() ?? 0,
    errors,
    done: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    },
  };
}

async function links(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href),
  );
}

async function capture(c: Ctxs, r: Route, width: number, findings: Finding[]) {
  const { page } = pick(c, r);
  await page.setViewportSize({ width, height: 900 });
  const v = await visit(page, r.app, r.path);
  v.done();
  const metrics = await measure(page);
  const axe: Finding['axe'] | undefined = width === 1024 ? { light: [], dark: [] } : undefined;
  for (const theme of THEMES) {
    await setTheme(page, theme);
    if (axe)
      axe[theme] = await axeSerious(page).catch((e: Error) => [
        { id: 'axe-error', impact: 'critical', nodes: 1, sample: e.message.slice(0, 80) },
      ]);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({
      path: join(FULL, `${slug(r.app, r.pattern)}__${width}__${theme}.jpg`),
      type: 'jpeg',
      quality: 55,
      fullPage: true,
      clip: { x: 0, y: 0, width, height: Math.min(height, MAX_SHOT_HEIGHT) },
    });
  }
  await setTheme(page, 'light');
  findings.push({
    app: r.app,
    pattern: r.pattern,
    width,
    metrics,
    ...(axe ? { axe } : {}),
    consoleErrors: v.errors,
  });
}

function loadRoutes(): Route[] {
  if (!existsSync(ROUTES))
    throw new Error('docs/ux/sweep/routes.json is missing: run the discover test first');
  return JSON.parse(readFileSync(ROUTES, 'utf8')) as Route[];
}

function saveFindings(rows: Finding[], keep: (f: Finding) => boolean) {
  const old: Finding[] = existsSync(FINDINGS)
    ? (JSON.parse(readFileSync(FINDINGS, 'utf8')) as Finding[])
    : [];
  writeFileSync(FINDINGS, `${JSON.stringify([...old.filter(keep), ...rows], null, 1)}\n`);
}

/** A page URL as the route table knows it: tenant hosts fold into `/t/{org}`, locales drop away. */
function toPath(u: URL): string | null {
  const tenant = /^([a-z0-9-]+)\.yayatoh\.events$/.exec(u.hostname);
  if (u.port !== String(WEB_PORT) && u.origin !== WEB) return null;
  if (tenant) return `/t/${tenant[1]}${stripLocale(u.pathname) === '/' ? '' : stripLocale(u.pathname)}`;
  if (u.hostname !== 'localhost') return null;
  return u.pathname.startsWith('/en') ? stripLocale(u.pathname) || '/' : null;
}

test('discover and capture at 1440 px', async ({ browser }) => {
  test.setTimeout(3 * 60 * 60_000);
  mkdirSync(FULL, { recursive: true });
  const c = await contexts(browser);
  const all: Record<App, Template[]> = { web: templates('web'), admin: templates('admin') };
  const seen = new Map<string, Route>();
  /** Template → last failed attempt (a 404 or a redirect away), kept if no seed ever works. */
  const failed = new Map<string, Route>();
  const queue: { app: App; path: string; actor: ActorKey }[] = [];
  const enqueued = new Set<string>();
  /** Same-origin links that match no page template: dead links (a 404 for every visitor). */
  const dead = new Map<string, string>();
  const push = (app: App, path: string, actor: ActorKey, from?: string) => {
    const t = matchTemplate(all[app], path);
    if (
      !t &&
      from &&
      !/^\/(?:api|_next|lang|sitemaps?|robots|scan\.webmanifest|opengraph|icon|favicon)/.test(path)
    )
      dead.set(`${app}:${path}`, from);
    const key = `${app}:${actor}:${path}`;
    if (!t || seen.has(`${app}:${t.pattern}`) || enqueued.has(key)) return;
    if (app === 'web' && EXCLUDED[t.pattern]) return;
    enqueued.add(key);
    queue.push({ app, path, actor });
  };
  // Seeds first (the entry pages, then every template the seeded actors can fill), links after.
  for (const app of ['web', 'admin'] as const)
    for (const t of all[app]) {
      if (app === 'admin') {
        if (!t.params.length) push('admin', t.pattern, 'staff');
        continue;
      }
      for (const cand of candidates(t.pattern)) push('web', cand.path, cand.actor);
    }
  if (existsSync(CANARY)) {
    const canary = JSON.parse(readFileSync(CANARY, 'utf8')) as {
      guestSite?: { code?: string };
      slug: string;
      event: { slug: string };
    };
    if (canary.guestSite?.code) push('web', `/w/${canary.guestSite.code}`, 'visitor');
    push('web', `/series/${canary.slug}-tour`, 'visitor');
    push('web', `/embed/${canary.event.slug}`, 'visitor');
    push('web', `/legal/${canary.slug}/refund`, 'visitor');
  }

  const findings: Finding[] = [];
  const done = new Set<string>();
  while (queue.length) {
    const next = queue.shift();
    if (!next) break;
    const t = matchTemplate(all[next.app], next.path);
    if (!t || seen.has(`${next.app}:${t.pattern}`)) continue;
    if (only && !only.test(t.pattern)) continue;
    const { page } = pick(c, next);
    await page.setViewportSize({ width: 1440, height: 900 });
    const v = await visit(page, next.app, next.path);
    v.done();
    const u = new URL(page.url());
    const finalPath = next.app === 'web' ? (toPath(u) ?? u.pathname) : u.pathname;
    const route: Route = {
      app: next.app,
      actor: next.actor,
      pattern: t.pattern,
      path: next.path,
      status: v.status,
    };
    if (finalPath !== next.path && finalPath !== `${next.path}/`) route.redirectedTo = finalPath;
    const key = `${next.app}:${t.pattern}`;
    // A 404 or a bounce to another page means this seed is not the right data: try the next one.
    if (v.status >= 400 || route.redirectedTo) {
      if (!failed.has(key) || v.status !== 404) failed.set(key, route);
      continue;
    }
    seen.set(key, route);
    // Follow links to discover templates the seeds don't fill.
    for (const href of await links(page)) {
      let l: URL;
      try {
        l = new URL(href);
      } catch {
        continue;
      }
      if (NO_FOLLOW.test(l.pathname)) continue;
      if (next.app === 'admin') {
        if (l.origin === ADMIN) push('admin', l.pathname, 'staff', next.path);
        continue;
      }
      const p = toPath(l);
      if (p) push('web', p, next.actor === 'staff' ? 'visitor' : next.actor, next.path);
    }
    await capture(c, route, 1440, findings);
    done.add(key);
    if (seen.size % 25 === 0) process.stdout.write(`sweep: ${seen.size} templates, ${queue.length} queued\n`);
  }
  // Templates no seed could open still get their (404 or redirect) page in the sweep, flagged.
  for (const [key, route] of failed) {
    if (seen.has(key)) continue;
    seen.set(key, route);
    await capture(c, route, 1440, findings);
  }
  const routes = [...seen.values()].sort((a, b) => (a.app + a.pattern).localeCompare(b.app + b.pattern));
  writeFileSync(ROUTES, `${JSON.stringify(routes, null, 1)}\n`);
  saveFindings(findings, (f) => f.width !== 1440);
  writeFileSync(
    DEAD,
    `${JSON.stringify(
      [...dead].map(([k, from]) => ({ link: k, from })),
      null,
      1,
    )}\n`,
  );
  await closeAll(c);
});

for (const width of [1024, 390] as const)
  test(`capture at ${width} px`, async ({ browser }) => {
    test.setTimeout(3 * 60 * 60_000);
    const routes = loadRoutes().filter((r) => !only || only.test(r.pattern));
    const c = await contexts(browser);
    const findings: Finding[] = [];
    for (const r of routes) await capture(c, r, width, findings);
    saveFindings(findings, (f) => f.width !== width);
    expect(findings.length).toBe(routes.length);
    await closeAll(c);
  });

/** The report's before/after pairs: the main screens at 1280 and 390 px, both themes (UX_SHOTS=before|after). */
const MAIN_SCREENS: { name: string; path: string; actor: ActorKey }[] = [
  { name: 'console-home', path: `/o/${ORG}`, actor: 'owner' },
  { name: 'command-center', path: `/o/${ORG}/command-center`, actor: 'owner' },
  { name: 'event-overview', path: `/o/${ORG}/e/${EVENT}`, actor: 'owner' },
  { name: 'tickets-orders', path: `/o/${ORG}/e/${EVENT}/tickets-orders`, actor: 'owner' },
  { name: 'new-audience', path: `/o/${ORG}/audiences/new`, actor: 'owner' },
  { name: 'finance', path: `/o/${ORG}/finance`, actor: 'owner' },
  { name: 'seating-library', path: `/o/${ORG}/seating-library`, actor: 'owner' },
  { name: 'public-event', path: `/events/${EVENT}`, actor: 'visitor' },
  { name: 'marketplace-home', path: '/', actor: 'visitor' },
  { name: 'not-found', path: '/events/no-such-event-u11', actor: 'visitor' },
];
test('main screens before/after shots', async ({ browser }) => {
  test.skip(!process.env.UX_SHOTS, 'set UX_SHOTS=before|after');
  test.setTimeout(30 * 60_000);
  const dir = join(REPO, 'docs/ux/screenshots/u11', process.env.UX_SHOTS ?? 'before');
  mkdirSync(dir, { recursive: true });
  const c = await contexts(browser);
  for (const m of MAIN_SCREENS)
    for (const width of [1280, 390] as const) {
      const { page } = pick(c, m);
      await page.setViewportSize({ width, height: 900 });
      await visit(page, 'web', m.path).then((v) => v.done());
      for (const theme of THEMES) {
        await setTheme(page, theme);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.screenshot({
          path: join(dir, `${m.name}__${width}__${theme}.jpg`),
          type: 'jpeg',
          quality: 60,
          fullPage: true,
          clip: { x: 0, y: 0, width, height: Math.min(height, 1800) },
        });
      }
    }
  await closeAll(c);
});

test('coverage: every page template is swept or excluded with a reason', () => {
  const routes = loadRoutes();
  const swept = new Set(routes.map((r) => `${r.app}:${r.pattern}`));
  const missing: string[] = [];
  for (const app of ['web', 'admin'] as const)
    for (const t of templates(app))
      if (
        !swept.has(`${app}:${t.pattern}`) &&
        !(app === 'web' ? EXCLUDED[t.pattern] : EXCLUDED_ADMIN[t.pattern])
      )
        missing.push(`${app}:${t.pattern}`);
  expect(missing, 'templates neither visited nor excluded').toEqual([]);
  const open = routes.filter((r) => r.status >= 400 || r.redirectedTo);
  process.stdout.write(
    `sweep: ${routes.length} routes (${open.length} gated by data or a flag), ${routes.length * WIDTHS.length * THEMES.length} screenshots\n`,
  );
});
