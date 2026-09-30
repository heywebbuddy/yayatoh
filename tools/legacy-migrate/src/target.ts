/**
 * Where a cutover or rollback script may write (M2.5a safety rule): nothing built here ever touches
 * production. A real (non dry-run) run needs `--target=local` or `--target=staging`; anything else
 * is refused. `local` accepts only local database hosts (localhost, loopback, the compose service);
 * `staging` only the hosts listed in `CUTOVER_STAGING_HOSTS`. Every configured database URL must
 * pass, a production environment marker is refused outright, and `--yes` (no per-step typed
 * confirmation) is accepted for `local` only.
 */
export type Target = 'local' | 'staging';

export const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'postgres',
  'db',
  'host.docker.internal',
]);

/** The environment variables that hold database URLs the scripts may connect with. */
export const DATABASE_URL_VARS = [
  'MIGRATOR_DATABASE_URL',
  'DATABASE_URL',
  'ADMIN_DATABASE_URL',
  'PLATFORM_READER_DATABASE_URL',
  'JOBS_DATABASE_URL',
] as const;

export class TargetRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetRefused';
  }
}

export interface TargetDecision {
  readonly target: Target;
  readonly hosts: readonly string[];
  readonly autoConfirm: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new TargetRefused('a database URL could not be read');
  }
}

/**
 * Decide whether a real run may go ahead. Throws `TargetRefused` with the reason; never prints a
 * URL or a password (only host names).
 */
export function checkTarget(
  target: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  opts: { yes?: boolean } = {},
): TargetDecision {
  if (target !== 'local' && target !== 'staging')
    throw new TargetRefused(
      `a real run needs --target=local or --target=staging (got ${target === undefined ? 'none' : `"${target}"`}); without it the script only plans (dry run)`,
    );
  if (env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production' || env.YAYATOH_ENV === 'production')
    throw new TargetRefused('refusing to run in a production environment');
  if (env.PAYMENTS_PROVIDER && env.PAYMENTS_PROVIDER !== 'fake')
    throw new TargetRefused(
      `refusing to run with PAYMENTS_PROVIDER=${env.PAYMENTS_PROVIDER}: the fake provider only`,
    );
  const hosts = [
    ...new Set(
      DATABASE_URL_VARS.map((k) => env[k])
        .filter((v): v is string => Boolean(v))
        .map(hostOf),
    ),
  ];
  if (hosts.length === 0) throw new TargetRefused('no database URL is configured');
  const staging = new Set(
    (env.CUTOVER_STAGING_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const allowed = target === 'local' ? LOCAL_HOSTS : staging;
  const bad = hosts.filter((h) => !allowed.has(h));
  if (bad.length)
    throw new TargetRefused(
      target === 'local'
        ? `--target=local refuses the database host(s) ${bad.join(', ')} (local hosts only)`
        : `--target=staging refuses the database host(s) ${bad.join(', ')} (not listed in CUTOVER_STAGING_HOSTS)`,
    );
  if (opts.yes && target !== 'local') throw new TargetRefused('--yes is allowed for --target=local only');
  return { target, hosts, autoConfirm: opts.yes === true };
}
