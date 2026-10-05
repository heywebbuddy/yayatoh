/** The deployment environment variables that mark production. */
export interface DeployEnv {
  readonly YAYATOH_ENV?: string | undefined;
  readonly VERCEL_ENV?: string | undefined;
}

/**
 * True on a production deployment. Self-hosted production sets `YAYATOH_ENV=production` (ADR 0024,
 * fixed in docker-compose.prod.yml, not only in Doppler); `VERCEL_ENV=production` still counts.
 * Everything that refuses fakes, dev logins or test keys in production asks this one question.
 */
export function isProductionEnv(env: DeployEnv = globalThis.process?.env ?? {}): boolean {
  return env.YAYATOH_ENV === 'production' || env.VERCEL_ENV === 'production';
}
