/**
 * The Maestro journey inventory (M7.x). Every journey in docs/plans/mobile.md has a flow (or a stated reason
 * why not), every flow in `apps/<app>/.maestro` is in that app's `journeys.json`, and no flow carries a
 * credential, a real service, or a hard-coded sleep. The EAS workflows list the flows this module says run in CI
 * (`ciFlows`), so the two cannot drift apart.
 *
 * Maestro cannot run in a cloud session, so this is a static check: it reads YAML, JSON and scripts, and runs
 * nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { parseAllDocuments } from 'yaml';

export const APPS = ['mobile', 'staff'] as const;
export type App = (typeof APPS)[number];
export type PlatformTag = 'ios' | 'android' | 'both';
export type Platform = 'ios' | 'android';

/** What a flow needs besides the build. */
export const NEEDS = [
  'dev-server',
  'seeded-data',
  'fake-providers',
  'two-devices',
  'door-device',
  'online-event',
  'console-actor',
  'push-sender',
  'min-version-server',
  'camera-hardware',
  'real-accounts',
  'signed-build',
  'device-locale',
  'system-ui',
] as const;
export type Need = (typeof NEEDS)[number];

/**
 * What the EAS runner can provide: the e2e build, a reachable server with the dev routes and the seed, and the
 * fake providers. Anything else keeps a flow out of the workflow.
 */
export const CI_PROVIDED: readonly Need[] = ['dev-server', 'seeded-data', 'fake-providers'];

export interface FlowEntry {
  kind: 'flow' | 'subflow';
  platforms: PlatformTag;
  /** The first thing the flow does is start the app from a clean state. */
  clean: boolean;
  /** Runs in the EAS workflow. */
  ci: boolean;
  ciReason?: string;
  needs: Need[];
  twoDevices?: boolean;
}

export interface Journey {
  id: string;
  title: string;
  platforms: PlatformTag;
  flows: string[];
  /** Fully manual: the reason (the flows listed, if any, cover only a part). */
  manual?: string;
  /** A platform no flow covers, with the reason. */
  manualPlatforms?: Partial<Record<Platform, string>>;
  /** Steps only a person on a device can do, for the device-pass list. */
  devicePass?: string[];
  notes?: string;
}

export interface Manifest {
  app: App;
  appId: string;
  flows: Record<string, FlowEntry>;
  journeys: Journey[];
}

export interface Problem {
  app: string;
  file: string;
  rule: string;
  message: string;
}

/** The journeys of docs/plans/mobile.md section 3 ("How mobile work is tested") that must each have a flow. */
export const REQUIRED_JOURNEYS: Record<App, readonly string[]> = {
  mobile: [
    'sign-in-email-code',
    'sign-in-apple',
    'sign-in-google',
    'sign-in-password-two-factor',
    'sign-out',
    'delete-account',
    'tickets-open-offline',
    'ticket-transfer-cancel',
    'claim-from-link',
    'refund-request',
    'wallet-add',
    'calendar-directions',
    'discover-search',
    'event-page',
    'buy-ticket-fake-provider',
    'cancel-payment',
    'orders-list-detail',
    'virtual-ticket-buy-on-web',
    'push-prompt-after-purchase',
    'push-not-now',
    'push-denied-blocks-nothing',
    'push-tap-foreground',
    'push-tap-cold-start',
    'link-cold-start',
    'link-resume-after-sign-in',
    'notification-settings',
    'offline-banner',
    'update-required',
    'arabic-rtl-smoke',
  ],
  staff: [
    'enrol-by-link',
    'enrol-by-qr',
    'pick-checkpoint',
    'scan-admit-and-duplicate',
    'scan-refusals',
    'scan-camera-denied',
    'scan-manual-validation',
    'offline-drill',
    'door-manual-checkin',
    'guest-list',
    'assistance-queue',
    'lookup',
    'lead-retrieval-offline-sync',
    'organizer-sign-in-totp',
    'organizer-event-day',
    'exhibitor-sign-in',
    'remote-wipe',
    'revoke',
    'update-required-outside-event-window',
    'update-required-inside-event-window',
    'arabic-rtl-smoke',
  ],
};

const MIN_REASON = 15;
const PLATFORM_TAGS: readonly string[] = ['ios', 'android', 'both'];

/** Patterns that mean a real secret or a real account is in a flow, a script or a payload. */
const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{8,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Sentry DSN', re: /https:\/\/[0-9a-f]{16,}@[^\s'"]*sentry\.io/ },
  { name: 'Yayatoh device token', re: /\byyd_[A-Za-z0-9_-]{16,}/ },
  { name: 'Yayatoh refresh token', re: /\byyr_[A-Za-z0-9_-]{16,}/ },
  { name: 'Yayatoh portal token', re: /\byyp_[A-Za-z0-9_-]{16,}/ },
  { name: 'Apple key file', re: /\bAuthKey_[A-Z0-9]{10}\.p8\b/ },
  { name: 'Expo token', re: /\bexpo_[A-Za-z0-9]{24,}/ },
  { name: 'Bearer credential', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/ },
];

/** Hosts a flow or script may reach: the e2e server, the emulator's host alias, and our own domains. */
const HOST_ALLOWED: readonly RegExp[] = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^10\.0\.2\.2$/,
  /^[a-z0-9.-]+\.test$/,
  /^example\.com$/,
  /^(www\.|app\.)?yayatoh\.com$/,
  /^[a-z0-9-]+\.yayatoh\.events$/,
];

const CREDENTIAL_KEY = /(pass(word)?|secret|token|api[_-]?key|private)/i;

const read = (path: string): string => readFileSync(path, 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const toPosix = (p: string) => p.split('\\').join('/');

interface ParsedFlow {
  config: Record<string, unknown> | null;
  commands: unknown[];
  errors: string[];
  header: string;
}

function parseFlow(text: string): ParsedFlow {
  const header: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') header.push(line);
    else break;
  }
  const docs = parseAllDocuments(text);
  const errors = docs.flatMap((d) => d.errors.map((e) => e.message.split('\n')[0] ?? 'YAML error'));
  const values = docs.map((d) => d.toJS() as unknown);
  const first = values[0];
  if (values.length >= 2 && first && typeof first === 'object' && !Array.isArray(first)) {
    const second = values[1];
    return {
      config: first as Record<string, unknown>,
      commands: Array.isArray(second) ? second : [],
      errors,
      header: header.join('\n'),
    };
  }
  if (Array.isArray(first)) return { config: null, commands: first, errors, header: header.join('\n') };
  return {
    config: first && typeof first === 'object' ? (first as Record<string, unknown>) : null,
    commands: [],
    errors,
    header: header.join('\n'),
  };
}

interface Command {
  name: string;
  arg: unknown;
}

function asCommand(value: unknown): Command | null {
  if (typeof value === 'string') return { name: value, arg: null };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const only = keys[0];
    if (keys.length === 1 && only !== undefined)
      return { name: only, arg: (value as Record<string, unknown>)[only] };
  }
  return null;
}

/** Every command in order, including those nested in `runFlow`, `repeat` and `retry` blocks. */
function eachCommand(commands: unknown[], visit: (c: Command) => void): void {
  for (const raw of commands) {
    const c = asCommand(raw);
    if (!c) continue;
    visit(c);
    if (c.arg && typeof c.arg === 'object' && !Array.isArray(c.arg)) {
      const nested = (c.arg as Record<string, unknown>).commands;
      if (Array.isArray(nested)) eachCommand(nested, visit);
    }
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The file a `runFlow` / `runScript` names, relative to the flow that names it, or null for inline commands. */
function fileArg(arg: unknown): string | null {
  if (typeof arg === 'string') return arg;
  const file = obj(arg).file;
  return typeof file === 'string' ? file : null;
}

export interface LoadedApp {
  app: App;
  dir: string;
  manifestPath: string;
  manifest: Manifest | null;
}

export function appDir(root: string, app: App): string {
  return join(root, 'apps', app, '.maestro');
}

export function loadManifest(root: string, app: App): { manifest: Manifest | null; problems: Problem[] } {
  const manifestPath = join(appDir(root, app), 'journeys.json');
  const file = `apps/${app}/.maestro/journeys.json`;
  if (!existsSync(manifestPath))
    return {
      manifest: null,
      problems: [{ app, file, rule: 'manifest', message: 'journeys.json is missing' }],
    };
  try {
    return { manifest: JSON.parse(read(manifestPath)) as Manifest, problems: [] };
  } catch (error) {
    return {
      manifest: null,
      problems: [
        { app, file, rule: 'manifest', message: `journeys.json is not valid JSON: ${String(error)}` },
      ],
    };
  }
}

const platformsOf = (tag: PlatformTag): Platform[] => (tag === 'both' ? ['ios', 'android'] : [tag]);

function checkManifestShape(
  app: App,
  m: Manifest,
  add: (file: string, rule: string, message: string) => void,
) {
  const f = 'journeys.json';
  if (m.app !== app) add(f, 'manifest', `"app" must be "${app}"`);
  if (typeof m.appId !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(m.appId))
    add(f, 'manifest', '"appId" must be a bundle id such as com.example.app.preview');
  if (!m.flows || typeof m.flows !== 'object') add(f, 'manifest', '"flows" must be an object');
  if (!Array.isArray(m.journeys)) add(f, 'manifest', '"journeys" must be an array');
  for (const [name, entry] of Object.entries(m.flows ?? {})) {
    if (entry.kind !== 'flow' && entry.kind !== 'subflow')
      add(name, 'manifest', 'kind must be "flow" or "subflow"');
    if (!PLATFORM_TAGS.includes(entry.platforms))
      add(name, 'manifest', 'platforms must be ios, android or both');
    if (typeof entry.clean !== 'boolean') add(name, 'manifest', '"clean" must be true or false');
    if (!Array.isArray(entry.needs)) add(name, 'manifest', '"needs" must be a list');
    for (const need of entry.needs ?? [])
      if (!(NEEDS as readonly string[]).includes(need)) add(name, 'manifest', `unknown need "${need}"`);
    // A sub-flow runs inside the flows that use it; only a flow has a place in the EAS workflow.
    if (entry.kind === 'subflow') continue;
    if (typeof entry.ci !== 'boolean') add(name, 'manifest', '"ci" must be true or false');
    if (entry.ci) {
      const missing = (entry.needs ?? []).filter((n) => !CI_PROVIDED.includes(n));
      if (missing.length > 0)
        add(name, 'ci', `runs in CI but needs ${missing.join(', ')}, which the EAS runner does not provide`);
      if (entry.twoDevices) add(name, 'ci', 'a two-device flow cannot run in CI');
    } else if ((entry.ciReason ?? '').trim().length < MIN_REASON) {
      add(name, 'ci', `ciReason (at least ${MIN_REASON} characters) is required when "ci" is false`);
    }
  }
}

function checkJourneys(app: App, m: Manifest, add: (file: string, rule: string, message: string) => void) {
  const seen = new Set<string>();
  for (const j of m.journeys ?? []) {
    const where = `journey ${j.id}`;
    if (!j.id || typeof j.id !== 'string') {
      add('journeys.json', 'journey', 'a journey has no id');
      continue;
    }
    if (seen.has(j.id)) add(where, 'journey', 'listed twice');
    seen.add(j.id);
    if (!j.title || j.title.trim().length < 5) add(where, 'journey', 'needs a title');
    if (!PLATFORM_TAGS.includes(j.platforms)) {
      add(where, 'journey', 'platforms must be ios, android or both');
      continue;
    }
    const flows = j.flows ?? [];
    const manual = typeof j.manual === 'string' ? j.manual.trim() : '';
    if (j.manual !== undefined && manual.length < MIN_REASON)
      add(where, 'journey', `"manual" needs a reason of at least ${MIN_REASON} characters`);
    if (flows.length === 0 && manual.length < MIN_REASON)
      add(where, 'no-flow', 'has no flow and is not marked manual with a reason');
    for (const flow of flows) {
      const entry = m.flows?.[flow];
      if (!entry) add(where, 'journey', `names ${flow}, which is not in "flows"`);
      else if (entry.kind !== 'flow') add(where, 'journey', `names ${flow}, which is a sub-flow`);
    }
    if (manual.length >= MIN_REASON) continue;
    for (const p of platformsOf(j.platforms)) {
      const covered = flows.some((flow) => {
        const entry = m.flows?.[flow];
        return entry ? platformsOf(entry.platforms).includes(p) : false;
      });
      const reason = (j.manualPlatforms?.[p] ?? '').trim();
      if (!covered && reason.length < MIN_REASON)
        add(where, 'no-flow', `no flow covers ${p} and manualPlatforms.${p} gives no reason`);
    }
  }
  for (const id of REQUIRED_JOURNEYS[app])
    if (!seen.has(id))
      add('journeys.json', 'required', `the plan's journey "${id}" is missing from the manifest`);
}

/** The static checks of one app. `root` is the repository root. */
export function checkApp(root: string, app: App): Problem[] {
  const problems: Problem[] = [];
  const dir = appDir(root, app);
  const base = `apps/${app}/.maestro`;
  const add = (file: string, rule: string, message: string) =>
    problems.push({ app, file: file.startsWith('journey ') ? file : `${base}/${file}`, rule, message });
  if (!existsSync(dir))
    return [{ app, file: base, rule: 'manifest', message: 'the .maestro directory is missing' }];
  const loaded = loadManifest(root, app);
  problems.push(...loaded.problems);
  const m = loaded.manifest;
  if (!m) return problems;
  checkManifestShape(app, m, add);
  checkJourneys(app, m, add);

  const files = walk(dir).map((p) => toPosix(relative(dir, p)));
  const flowFiles = files.filter((f) => /\.ya?ml$/.test(f));
  for (const f of flowFiles)
    if (!m.flows?.[f]) add(f, 'unlisted', 'is a flow in the directory but not in journeys.json');
  for (const f of Object.keys(m.flows ?? {}))
    if (!flowFiles.includes(f)) add(f, 'missing', 'is listed in journeys.json but the file does not exist');

  const referenced = new Set<string>();
  const parsed = new Map<string, ParsedFlow>();
  for (const f of flowFiles) parsed.set(f, parseFlow(read(join(dir, f))));

  const resolve = (from: string, target: string): string =>
    posix.normalize(posix.join(posix.dirname(from), target));

  for (const f of flowFiles) {
    const entry = m.flows?.[f];
    const flow = parsed.get(f);
    if (!flow) continue;
    for (const error of flow.errors) add(f, 'yaml', error);
    const config = flow.config;
    const appId = config?.appId;
    if (typeof appId !== 'string' || appId.trim() === '') add(f, 'appId', 'has no appId');
    else if (appId.includes('${'))
      add(f, 'appId', 'appId must be written out, not a variable: Maestro reads it before any variable');
    else if (appId !== m.appId) add(f, 'appId', `appId is ${appId}; the app's e2e build is ${m.appId}`);
    for (const marker of ['Journey:', 'Preconditions:', 'Personas:'])
      if (!new RegExp(`^# ${marker}`, 'm').test(flow.header))
        add(f, 'header', `the top comment needs a "# ${marker}" line`);

    // Credential-like values written into env maps.
    const checkEnv = (env: unknown) => {
      for (const [key, value] of Object.entries(obj(env)))
        if (CREDENTIAL_KEY.test(key) && typeof value === 'string' && value !== '' && !value.startsWith('${'))
          add(f, 'credential', `env ${key} holds a literal value; pass it with -e or MAESTRO_ at run time`);
    };
    checkEnv(config?.env);

    const names: string[] = [];
    eachCommand(flow.commands, (c) => {
      names.push(c.name);
      const arg = obj(c.arg);
      if (c.name === 'runFlow' || c.name === 'runScript') {
        checkEnv(arg.env);
        const target = fileArg(c.arg);
        if (target) {
          const resolved = resolve(f, target);
          if (!existsSync(join(dir, resolved))) add(f, 'reference', `${c.name} ${target} does not exist`);
          else if (c.name === 'runFlow') {
            referenced.add(resolved);
            if (!m.flows?.[resolved]) add(f, 'reference', `runFlow ${target} is not in journeys.json`);
          }
        }
      }
      if (c.name === 'setAirplaneMode' && entry && entry.platforms !== 'android')
        add(f, 'platform', 'setAirplaneMode does not work on the iOS simulator; tag the flow "android"');
      if (['sleep', 'wait', 'delay', 'pause'].includes(c.name))
        add(f, 'sleep', `"${c.name}" is not a Maestro command and would be a hard-coded sleep`);
      if (c.name === 'waitForAnimationToEnd' && Number(arg.timeout ?? 0) > 3000)
        add(
          f,
          'sleep',
          'waitForAnimationToEnd longer than 3 s is a sleep; wait for the thing itself with extendedWaitUntil',
        );
      if (c.name === 'extendedWaitUntil' && arg.optional === true && Number(arg.timeout ?? 0) > 3000) {
        const limit = entry?.twoDevices ? 60000 : 3000;
        if (Number(arg.timeout) > limit)
          add(
            f,
            'sleep',
            entry?.twoDevices
              ? 'an optional wait longer than 60 s; the two-phone drill needs no more'
              : 'an optional extendedWaitUntil longer than 3 s is a hard-coded sleep (only two-device flows may hold a phone this way)',
          );
      }
    });

    if (entry?.clean) {
      const verdict = startsClean(parsed, f, resolve, new Set());
      if (verdict) add(f, 'clean', verdict);
    }
  }

  for (const [f, entry] of Object.entries(m.flows ?? {})) {
    if (entry.kind === 'flow' && !(m.journeys ?? []).some((j) => (j.flows ?? []).includes(f)))
      add(f, 'orphan', 'is not part of any journey');
    if (entry.kind === 'subflow' && flowFiles.includes(f) && !referenced.has(f))
      add(f, 'orphan', 'is a sub-flow no flow runs');
  }

  // Scripts, payloads and shell helpers: no secrets, no real hosts, no sleeps.
  const scanned = files.filter((p) => /\.(ya?ml|js|sh|json)$/.test(p) && p !== 'journeys.json');
  for (const f of scanned) {
    const text = read(join(dir, f));
    for (const { name, re } of SECRET_PATTERNS)
      if (re.test(text)) add(f, 'credential', `looks like a real ${name}`);
    for (const url of text.match(/https?:\/\/[^\s'"`)>]+/g) ?? []) {
      const host = /^https?:\/\/([^/:?#]+)/.exec(url)?.[1]?.toLowerCase() ?? '';
      if (host === '' || host.startsWith('$') || host.includes('${')) continue;
      if (!HOST_ALLOWED.some((re) => re.test(host)))
        add(f, 'host', `reaches ${host}, which is not a test host`);
    }
    if (
      f.endsWith('.js') &&
      /\bsleep\s*\(|setTimeout\s*\(|Thread\.sleep|while\s*\(\s*Date\.now\(\)/.test(text)
    )
      add(f, 'sleep', 'a script that sleeps or busy-waits; wait in the flow with extendedWaitUntil');
    if (f.endsWith('.json')) {
      try {
        JSON.parse(text);
      } catch {
        add(f, 'json', 'is not valid JSON');
      }
    }
  }
  return problems;
}

/**
 * The first thing a "clean" flow does must start the app from a clean state: `launchApp` with `clearState`, or
 * a sub-flow that does. Scripts and variables may come first. Later `launchApp` calls are restarts and may keep state.
 */
function startsClean(
  parsed: Map<string, ParsedFlow>,
  file: string,
  resolve: (from: string, target: string) => string,
  seen: Set<string>,
): string | null {
  if (seen.has(file)) return 'runs itself';
  seen.add(file);
  const flow = parsed.get(file);
  if (!flow) return `${file} is not a flow`;
  return firstStep(flow.commands, parsed, file, resolve, seen);
}

function firstStep(
  commands: unknown[],
  parsed: Map<string, ParsedFlow>,
  file: string,
  resolve: (from: string, target: string) => string,
  seen: Set<string>,
): string | null {
  for (const raw of commands) {
    const c = asCommand(raw);
    if (!c) continue;
    if (c.name === 'runScript' || c.name === 'evalScript') continue;
    if (c.name === 'clearState') return null;
    if (c.name === 'launchApp')
      return obj(c.arg).clearState === true
        ? null
        : 'its first launchApp must set clearState: true (the manifest says clean)';
    if (c.name === 'runFlow') {
      const target = fileArg(c.arg);
      if (target) return startsClean(parsed, resolve(file, target), resolve, seen);
      const inline = obj(c.arg).commands;
      if (Array.isArray(inline)) return firstStep(inline, parsed, file, resolve, seen);
    }
    return `must start from a clean state, but its first step is ${c.name} (the manifest says clean)`;
  }
  return 'has no commands';
}

export function checkAll(root: string): Problem[] {
  return APPS.flatMap((app) => checkApp(root, app));
}

/** The flows the EAS workflow runs for one platform, as repository-relative paths, sorted. */
export function ciFlows(root: string, app: App, platform: Platform): string[] {
  const { manifest } = loadManifest(root, app);
  if (!manifest) return [];
  return Object.entries(manifest.flows)
    .filter(([, e]) => e.kind === 'flow' && e.ci && platformsOf(e.platforms).includes(platform))
    .map(([name]) => `apps/${app}/.maestro/${name}`)
    .sort();
}

const label = (p: PlatformTag) => (p === 'both' ? 'iOS, Android' : p === 'ios' ? 'iOS' : 'Android');

/** The journey table of docs/specs/M7.X/maestro.md, as Markdown. */
export function journeyTable(root: string, app: App): string {
  const { manifest } = loadManifest(root, app);
  if (!manifest) return '';
  const rows = [
    '| Journey | Flow | Platforms | Runs in EAS | Why not, or what stays manual |',
    '|---|---|---|---|---|',
  ];
  for (const j of manifest.journeys) {
    const flows = j.flows.map((f) => `\`${f}\``).join(', ') || 'none';
    const inCi = platformsOf(j.platforms).filter((p) =>
      j.flows.some((f) => {
        const e = manifest.flows[f];
        return e?.ci && platformsOf(e.platforms).includes(p);
      }),
    );
    const all = platformsOf(j.platforms);
    const ci =
      inCi.length === 0
        ? 'no'
        : inCi.length === all.length
          ? 'yes'
          : `${inCi.map((p) => (p === 'ios' ? 'iOS' : 'Android')).join(', ')} only`;
    const why: string[] = [];
    if (j.manual) why.push(`manual: ${j.manual}`);
    for (const [p, r] of Object.entries(j.manualPlatforms ?? {}))
      why.push(`${p === 'ios' ? 'iOS' : 'Android'}: ${r}`);
    if (inCi.length < all.length && !j.manual && !j.manualPlatforms) {
      for (const f of j.flows) {
        const e = manifest.flows[f];
        if (e && !e.ci && e.ciReason) why.push(e.ciReason);
      }
    }
    for (const step of j.devicePass ?? []) why.push(`device pass: ${step}`);
    rows.push(
      `| ${j.title} | ${flows} | ${label(j.platforms)} | ${ci} | ${why.join(' ').replaceAll('|', '/') || '-'} |`,
    );
  }
  return rows.join('\n');
}

export function formatProblems(problems: Problem[]): string[] {
  return problems.map((p) => `✗ [${p.rule}] ${p.file}: ${p.message}`);
}
