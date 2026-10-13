import type { AppSignIn, BearerSession, BearerSessions } from '@yayatoh/auth';
import type { ApiAccessQuotas } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import type { CommandPorts, Ctx } from '@yayatoh/kernel';
import type { PaymentProvider } from '@yayatoh/payments';
import type { ApiKeyIdentity } from '@yayatoh/tenancy';
import type { RateLimiter } from './rate-limit.ts';

/** Who is calling: an org API key or a signed-in user (bearer session). Devices use the scanner routes. */
export type Principal =
  | { readonly kind: 'api_key'; readonly key: ApiKeyIdentity }
  | { readonly kind: 'user'; readonly session: BearerSession };

export interface MobileSettings {
  readonly minimumVersions: { readonly ios: string; readonly android: string };
  readonly latestVersions: { readonly ios: string; readonly android: string };
  readonly baseUrls: { readonly api: string; readonly web: string };
  readonly features: Readonly<Record<string, boolean>>;
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
