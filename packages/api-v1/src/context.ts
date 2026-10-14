import type { AppSignIn, BearerSession, BearerSessions } from '@yayatoh/auth';
import type { ApiAccessQuotas } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import type { CommandPorts, Ctx } from '@yayatoh/kernel';
import type { PaymentProvider } from '@yayatoh/payments';
import type { RateLimiter as PlatformRateLimiter } from '@yayatoh/platform/security';
import type { ApiKeyIdentity } from '@yayatoh/tenancy';
import type { PortalMailer } from './portal-mail.ts';
import type { RateLimiter } from './rate-limit.ts';

/** Who is calling: an org API key or a signed-in user (bearer session). Devices use the scanner routes. */
export type Principal =
  | { readonly kind: 'api_key'; readonly key: ApiKeyIdentity }
  | { readonly kind: 'user'; readonly session: BearerSession };

/** The four mobile apps, as they name themselves in `X-Yayatoh-Client` (M7.1c, M7.2d). */
export const MOBILE_CLIENTS = [
  'yayatoh-ios',
  'yayatoh-android',
  'yayatoh-staff-ios',
  'yayatoh-staff-android',
] as const;
export type MobileClient = (typeof MOBILE_CLIENTS)[number];

/** One app's version policy: below `minimumVersion` its `/v1` calls get a 426 pointing at `storeUrl`. */
export interface MobileAppSettings {
  readonly minimumVersion: string;
  readonly latestVersion: string;
  readonly storeUrl: string;
}

export interface MobileSettings {
  /** The attendee apps' minimum per platform (kept for the older clients); see `apps`. */
  readonly minimumVersions: { readonly ios: string; readonly android: string };
  readonly latestVersions: { readonly ios: string; readonly android: string };
  readonly baseUrls: { readonly api: string; readonly web: string };
  readonly features: Readonly<Record<string, boolean>>;
  /**
   * M7.2d: per-app overrides. An app left out (or a field left out) takes the attendee apps'
   * per-platform values above, or no minimum for the Staff apps.
   */
  readonly apps?: Readonly<Partial<Record<MobileClient, Partial<MobileAppSettings>>>>;
}

export interface V1Deps {
  readonly ports: CommandPorts<TenantTx>;
  /** Bearer sessions (Better Auth). Without it, only API keys and device tokens authenticate. */
  readonly sessions?: () => BearerSessions;
  /**
   * M7.2a: app sign-in (emailed code, Apple and Google id_tokens, the two-factor step) and
   * step-up on bearer sessions. Without it those grants and routes answer 404.
   */
  readonly appSignIn?: () => AppSignIn;
  readonly payments: () => PaymentProvider;
  readonly rateLimiter?: RateLimiter;
  /** Count requests per route × client × app version (on unless false). */
  readonly telemetry?: boolean;
  readonly mobile?: Partial<MobileSettings>;
  /** Test seam: the clock for the Staff event window of the version gate (default: the real time). */
  readonly now?: () => Date;
  /**
   * The web app's origin, which serves `/media/…` (images get absolute URLs). Default: the
   * request's origin, right for the web mount; `apps/api` sets `NEXT_PUBLIC_APP_ORIGIN`.
   */
  readonly publicOrigin?: string;
  /** How long a new bulk operation runs in the request that starts it (default 3 s; 0: never). */
  readonly bulkInlineMs?: number;
  /** Where the router is mounted (`/v1` on api.yayatoh.com, `/api/v1` on the web app). */
  readonly basePath?: string;
  /** M6.3a: an org's `api_access` quotas (default: its plan, from billing; null = no API access). */
  readonly apiQuotas?: (orgId: string) => Promise<ApiAccessQuotas | null>;
  /** How long an org's quotas are cached (default 30 s). */
  readonly quotaCacheMs?: number;
  /** M6.3a: count each API key's requests per day (on unless false). */
  readonly keyUsage?: boolean;
  /** M7.2e: sends the portal sign-in code and invitation emails (default: the notifications providers, as the web app's guest codes). */
  readonly portalMail?: PortalMailer;
  /** M7.2e: the M1.14 limiter behind the portal sign-in (default: Upstash when configured, else Postgres counters). */
  readonly portalLimiter?: PlatformRateLimiter;
  /** M7.2f: the M1.14 limiter behind the apps' checkout, the web's `checkoutStart` policy (default as `portalLimiter`). */
  readonly checkoutLimiter?: PlatformRateLimiter;
}

/**
 * The signed-in person behind a `/me/…` request (see `meScope`): a user bearer session whose email
 * is verified. Routes that need the person (my tickets, my orders, my devices) read this.
 */
export interface MeContext {
  readonly session: BearerSession;
  readonly user: BearerSession['user'];
  /**
   * The person's context: actor `user`, no org (`orgId` is null), the session's `stepUpAt`, the
   * request id and `Accept-Language`. Never tenant-scoped: queries across orgs resolve the person
   * by their verified email, or enter an org with their own `createCtx({ orgId, … })`.
   */
  readonly ctx: Ctx;
}

export type V1Env = {
  Variables: {
    requestId: string;
    principal: Principal | null;
    /** The tenant context of an `/orgs/{org}/…` request (org from the path, checked against the credential). */
    ctx: Ctx;
    /** M7.2a: the signed-in person of a `/me/…` request (set by `meScope`). */
    me: MeContext;
  };
};
