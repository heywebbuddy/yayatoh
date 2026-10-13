import type { BearerSession, BearerSessions } from '@yayatoh/auth';
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
  /** M7.2e: sends the portal sign-in code and invitation emails (default: the notifications providers, as the web app's guest codes). */
  readonly portalMail?: PortalMailer;
  /** M7.2e: the M1.14 limiter behind the portal sign-in (default: Upstash when configured, else Postgres counters). */
  readonly portalLimiter?: PlatformRateLimiter;
}

export type V1Env = {
  Variables: {
    requestId: string;
    principal: Principal | null;
    /** The tenant context of an `/orgs/{org}/…` request (org from the path, checked against the credential). */
    ctx: Ctx;
  };
};
