/**
 * Crash reporting (M7.1c, decision P7-11): `@sentry/react-native` with personal data scrubbed before
 * anything leaves the phone. Without a DSN (every development, test and unconfigured build) it does
 * nothing at all.
 *
 * Privacy rules this enforces (`mobile-common.md`): no personal data in crash reports. Sentry's own
 * default PII is off; `scrubEvent` then removes the user, request headers, cookies and bodies,
 * query strings, and masks emails, phone numbers, bearer and Yayatoh tokens, JWTs, long hex strings
 * and identifier-like URL segments in every string it can find.
 */
import * as Sentry from '@sentry/react-native';

export interface SentryConfig {
  /** The project DSN (`EXPO_PUBLIC_SENTRY_DSN`); empty or missing disables reporting. */
  readonly dsn?: string | null;
  readonly environment: string;
  /** `yayatoh-ios@1.4.2+45`. */
  readonly release?: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const YAYATOH_TOKEN = /\byy[a-z]{0,2}_[A-Za-z0-9_-]{6,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{7,}\d(?![\w.])/g;
const SENSITIVE_KEY =
  /e-?mail|token|password|passcode|secret|authorization|cookie|phone|name|address|ticket|qr|code|key|nonce|challenge/i;

/** Masks personal data and secrets inside free text. */
export function scrubText(text: string): string {
  return text
    .replace(BEARER, 'Bearer [token]')
    .replace(JWT, '[jwt]')
    .replace(YAYATOH_TOKEN, '[token]')
    .replace(EMAIL, '[email]')
    .replace(LONG_HEX, '[hex]')
    .replace(PHONE, '[phone]');
}

const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{16,}|\d{4,})$/i;

/** A URL without its query, fragment, credentials or identifier-like path segments. */
export function scrubUrl(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)(?:[^/@]*@)?([^/?#]*)([^?#]*)/i.exec(url);
  if (!m) return scrubText(url.split(/[?#]/, 1)[0] ?? '');
  const path = (m[3] ?? '')
    .split('/')
    .map((s) => (ID_SEGMENT.test(s) ? ':id' : scrubText(s)))
    .join('/');
  return `${m[1]}${m[2]}${path}`;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Scrubs every string in a value. With `dropKeys`, entries whose key names a personal field are
 * replaced too (used for `extra` and `tags`, which hold whatever a developer attached; stack frames
 * have keys like `filename` that must stay).
 */
export function scrubValue(value: unknown, dropKeys = false, depth = 0): unknown {
  if (depth > 8) return '[deep]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, dropKeys, depth + 1));
  if (isObject(value)) {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = dropKeys && SENSITIVE_KEY.test(k) ? '[removed]' : scrubValue(v, dropKeys, depth + 1);
    }
    return out;
  }
  return value;
}

export interface ScrubbableEvent {
  [key: string]: unknown;
}

/** The event with the person, the request's data and every identifier-like string removed. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const e: ScrubbableEvent = { ...event };
  delete e.user;
  delete e.server_name;
  if (isObject(e.request)) {
    const r = e.request;
    e.request = {
      ...(typeof r.method === 'string' ? { method: r.method } : {}),
      ...(typeof r.url === 'string' ? { url: scrubUrl(r.url) } : {}),
    };
  }
  for (const key of ['message', 'transaction', 'culprit']) {
    if (typeof e[key] === 'string')
      e[key] = key === 'transaction' ? scrubUrl(e[key] as string) : scrubText(e[key] as string);
  }
  if (isObject(e.exception) && Array.isArray(e.exception.values)) {
    e.exception = { ...e.exception, values: scrubValue(e.exception.values) };
  }
  if (isObject(e.contexts)) {
    const { device, ...rest } = e.contexts as Json;
    const d = isObject(device) ? device : {};
    // Keep what helps debug a crash (model, OS, memory); never the device's name or location.
    const { name: _name, geo: _geo, ...safeDevice } = d;
    e.contexts = { ...(scrubValue(rest) as Json), device: scrubValue(safeDevice) };
  }
  for (const key of ['extra', 'tags']) if (isObject(e[key])) e[key] = scrubValue(e[key], true);
  if (Array.isArray(e.breadcrumbs))
    e.breadcrumbs = e.breadcrumbs.map((b) => scrubBreadcrumb(b as ScrubbableEvent));
  return e as T;
}

/** A breadcrumb with its URL cleaned and its text masked; HTTP bodies and headers are dropped. */
export function scrubBreadcrumb<T extends ScrubbableEvent>(crumb: T): T {
  const c: ScrubbableEvent = { ...crumb };
  if (typeof c.message === 'string') c.message = scrubText(c.message);
  if (isObject(c.data)) {
    const d: Json = {};
    for (const [k, v] of Object.entries(c.data)) {
      if (k === 'url' && typeof v === 'string') d.url = scrubUrl(v);
      else if (/^(?:method|status_code|reason|from|to)$/.test(k))
        d[k] = typeof v === 'string' ? scrubUrl(v) : v;
    }
    c.data = d;
  }
  return c as T;
}

/** A DSN is `https://<key>@<host>/<project>`; anything else (or empty) leaves Sentry off. */
export const isValidDsn = (dsn: string | null | undefined): dsn is string =>
  typeof dsn === 'string' && /^https:\/\/[^@\s/]+@[^/\s]+\/\d+$/.test(dsn.trim());

let enabled = false;

/** Starts Sentry when a DSN is configured. Returns whether it is on. */
export function initSentry(config: SentryConfig, sentry: Pick<typeof Sentry, 'init'> = Sentry): boolean {
  if (!isValidDsn(config.dsn)) {
    enabled = false;
    return false;
  }
  sentry.init({
    dsn: config.dsn.trim(),
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 50,
    beforeSend: (event) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
    beforeBreadcrumb: (crumb) =>
      scrubBreadcrumb(crumb as unknown as ScrubbableEvent) as unknown as typeof crumb,
  });
  enabled = true;
  return true;
}

/** Reports a handled error. Does nothing when Sentry is off. */
export function reportError(error: unknown, sentry: Pick<typeof Sentry, 'captureException'> = Sentry): void {
  if (!enabled) return;
  sentry.captureException(error instanceof Error ? error : new Error(scrubText(String(error))));
}

export const sentryEnabled = () => enabled;
