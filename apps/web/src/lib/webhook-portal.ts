/**
 * Frame sources for the embedded webhook portal (M6.3b): Svix's App Portal origin on the console's
 * portal page once Svix is configured (`SVIX_API_KEY`, owner inbox; `SVIX_PORTAL_ORIGIN` overrides
 * it for a custom portal domain). The fake portal is same-origin, which the console already allows,
 * so dev, preview and CI add nothing and their headers are unchanged. Pure (runs in proxy.ts).
 */
export function webhookPortalFrameSources(path: string, env: Record<string, string | undefined>): string[] {
  if (!/^\/o\/[^/]+\/webhooks\/portal\/?$/.test(path) || !env.SVIX_API_KEY) return [];
  const origin = env.SVIX_PORTAL_ORIGIN || 'https://app.svix.com';
  return /^https:\/\/[a-z0-9.-]+$/.test(origin) ? [origin] : [];
}
