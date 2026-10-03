import { DomainError, isDomainError } from '@yayatoh/kernel';
import { assertPublicUrl, type Resolver } from '@yayatoh/platform/ssrf';

/**
 * Why an endpoint URL is refused (M6.3b; roadmap §6.3 "SSRF blocking at registration"): https on
 * port 443, no credentials, a public host name or address. Svix re-checks every address when it
 * sends, so a name that later resolves to a private address is still not reached.
 */
export const URL_PROBLEMS = [
  'malformed',
  'scheme',
  'credentials',
  'port',
  'host',
  'address',
  'dns',
  'length',
] as const;
export type UrlProblem = (typeof URL_PROBLEMS)[number];

export const MAX_URL_LENGTH = 2048;

export async function endpointUrlProblem(raw: string, resolver: Resolver): Promise<UrlProblem | null> {
  if (raw.length > MAX_URL_LENGTH) return 'length';
  try {
    await assertPublicUrl(raw, { allowedPorts: [443], resolver });
    return null;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = /URL not allowed: (\w+)/.exec(err.message)?.[1];
    return (URL_PROBLEMS as readonly string[]).includes(reason ?? '') ? (reason as UrlProblem) : 'malformed';
  }
}

export async function assertEndpointUrl(raw: string, resolver: Resolver): Promise<void> {
  const problem = await endpointUrlProblem(raw, resolver);
  if (problem)
    throw new DomainError('validation_failed', 'This URL cannot receive webhooks', {
      issues: [{ path: 'url', code: problem }],
      reason: problem,
    });
}
