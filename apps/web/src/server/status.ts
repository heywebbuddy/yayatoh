import 'server-only';
import {
  betterStackStatusPage,
  fakeStatusPage,
  type IncidentBanner,
  incidentBanner,
  type StatusPage,
  type StatusSnapshot,
} from '@yayatoh/platform';

let port: StatusPage | null | undefined;

/**
 * The status page provider (M3.11b): Better Stack when its keys are set
 * (`STATUS_PAGE_PROVIDER=betterstack`, `BETTER_STACK_API_TOKEN`, `BETTER_STACK_STATUS_PAGE_ID`;
 * owner account), otherwise the fake adapter in development, preview and CI. Production without
 * the provider has no status source (null): the page says so and no banner shows.
 */
export function getStatusPage(): StatusPage | null {
  if (port !== undefined) return port;
  const production = process.env.VERCEL_ENV === 'production';
  const provider = process.env.STATUS_PAGE_PROVIDER || (production ? 'betterstack' : 'fake');
  const token = process.env.BETTER_STACK_API_TOKEN;
  const statusPageId = process.env.BETTER_STACK_STATUS_PAGE_ID;
  port =
    provider === 'betterstack'
      ? token && statusPageId
        ? betterStackStatusPage({ token, statusPageId })
        : null
      : production
        ? null
        : fakeStatusPage;
  return port;
}

/** The current status, or null when there is no provider or it can't be reached (logged). */
export async function statusSnapshot(): Promise<StatusSnapshot | null> {
  const p = getStatusPage();
  if (!p) return null;
  try {
    return await p.snapshot();
  } catch (err) {
    console.error(JSON.stringify({ statusPage: 'unavailable', provider: p.provider, message: String(err) }));
    return null;
  }
}

/** The incident banner for the console and the marketplace (null when all is well). */
export async function statusBanner(): Promise<IncidentBanner | null> {
  return incidentBanner(await statusSnapshot());
}
