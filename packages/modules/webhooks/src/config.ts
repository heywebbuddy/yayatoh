import { defaultResolver, type Resolver } from '@yayatoh/platform/ssrf';
import { fakePublisher } from './fake.ts';
import type { WebhookPublisher } from './port.ts';
import { svixPublisher } from './svix.ts';

/**
 * The publisher for this deployment (M6.3b): Svix when `SVIX_API_KEY` is set (owner inbox), the
 * fake everywhere else except production, where webhooks stay off (null) until Svix is set up.
 */
export function webhookPublisherFromEnv(env: NodeJS.ProcessEnv, appOrigin: string): WebhookPublisher | null {
  if (env.SVIX_API_KEY)
    return svixPublisher({ apiKey: env.SVIX_API_KEY, serverUrl: env.SVIX_SERVER_URL || undefined });
  if (env.VERCEL_ENV === 'production') return null;
  const seed = env.FAKE_WEBHOOKS_SECRET || env.APP_TOKEN_SECRET || env.BETTER_AUTH_SECRET;
  if (!seed || seed.length < 32) return null;
  return fakePublisher({ seed, appOrigin });
}

/** The seed the fake publisher signs portal links with (the fake portal page checks them). */
export function fakeWebhookSeed(env: NodeJS.ProcessEnv): string | null {
  if (env.SVIX_API_KEY || env.VERCEL_ENV === 'production') return null;
  const seed = env.FAKE_WEBHOOKS_SECRET || env.APP_TOKEN_SECRET || env.BETTER_AUTH_SECRET;
  return seed && seed.length >= 32 ? seed : null;
}

/**
 * Names reserved for testing (`.test`, `.example`, `example.com/net/org`) resolve to a public
 * documentation-free address with the fake publisher, so dev and CI can register endpoints without
 * DNS. Everything else resolves for real and must be public.
 */
export const fakeResolver: Resolver = async (hostname) =>
  /(^|\.)(test|example|example\.com|example\.net|example\.org)\.?$/i.test(hostname)
    ? [{ address: '93.184.215.14', family: 4 }]
    : defaultResolver(hostname);

export interface WebhooksRuntime {
  readonly publisher: WebhookPublisher | null;
  readonly resolver: Resolver;
}

let runtime: WebhooksRuntime | null = null;

/** Set by each composition root (web, worker, tests) before commands run. */
export function configureWebhooks(r: WebhooksRuntime): void {
  runtime = r;
}

export function webhooksRuntime(): WebhooksRuntime {
  return runtime ?? { publisher: null, resolver: defaultResolver };
}
