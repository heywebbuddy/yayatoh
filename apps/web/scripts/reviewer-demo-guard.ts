/**
 * Where the reviewer demo may run (M7.5a). The demo creates a public organization, a sign-in address
 * with a fixed email code and a door enrolment link, so it never runs against production: not by
 * environment name, not by database host, not with a real payment provider. `--target=local` accepts
 * local database hosts only; `--target=staging` accepts only the hosts listed in
 * `REVIEWER_DEMO_HOSTS` (comma-separated), which the owner sets for the review server's database.
 */
export class DemoRefused extends Error {
  override name = 'DemoRefused';
}

export type DemoTarget = 'local' | 'staging';
export type Env = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);
const DATABASE_URL_VARS = [
  'DATABASE_URL',
  'MIGRATOR_DATABASE_URL',
  'ADMIN_DATABASE_URL',
  'PLATFORM_READER_DATABASE_URL',
  'JOBS_DATABASE_URL',
] as const;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new DemoRefused('a database URL in the environment cannot be read');
  }
}

/** Throws `DemoRefused` with the reason (host names only; never a URL or a password). */
export function checkDemoTarget(
  target: string | undefined,
  env: Env,
): { target: DemoTarget; hosts: string[] } {
  if (target !== 'local' && target !== 'staging')
    throw new DemoRefused(
      `pass --target=local or --target=staging (got ${target === undefined ? 'none' : `"${target}"`})`,
    );
  if (env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production' || env.YAYATOH_ENV === 'production')
    throw new DemoRefused('refusing to run in a production environment');
  if (env.PAYMENTS_PROVIDER && env.PAYMENTS_PROVIDER !== 'fake')
    throw new DemoRefused(
      `refusing to run with PAYMENTS_PROVIDER=${env.PAYMENTS_PROVIDER}: the fake provider only`,
    );
  const hosts = [
    ...new Set(
      DATABASE_URL_VARS.map((k) => env[k])
        .filter((v): v is string => Boolean(v))
        .map(hostOf),
    ),
  ];
  if (hosts.length === 0) throw new DemoRefused('no database URL is configured');
  const staging = new Set(
    (env.REVIEWER_DEMO_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const allowed = target === 'local' ? LOCAL_HOSTS : staging;
  const bad = hosts.filter((h) => !allowed.has(h));
  if (bad.length > 0)
    throw new DemoRefused(
      target === 'local'
        ? `--target=local refuses the database host(s) ${bad.join(', ')} (local hosts only)`
        : `--target=staging refuses the database host(s) ${bad.join(', ')} (not listed in REVIEWER_DEMO_HOSTS)`,
    );
  if (target === 'staging' && !env.YAYATOH_ENV)
    throw new DemoRefused(
      "--target=staging needs YAYATOH_ENV set to the review server's name (not production)",
    );
  return { target, hosts };
}
