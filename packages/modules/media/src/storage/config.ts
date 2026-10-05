import type { MediaStore } from './port.ts';
import { postgresMediaStore } from './postgres.ts';
import { r2MediaStore } from './r2.ts';

/**
 * The deployment's media store, from its environment. `MEDIA_STORE=r2` needs the owner's R2
 * credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_MEDIA_BUCKET`);
 * otherwise dev, preview and CI keep files in Postgres. Production refuses the Postgres store.
 */
export function mediaStoreFromEnv(env: Readonly<Record<string, string | undefined>>): MediaStore {
  const which = env.MEDIA_STORE || 'postgres';
  if (which === 'r2') {
    const accountId = env.R2_ACCOUNT_ID;
    const accessKeyId = env.R2_ACCESS_KEY_ID;
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
    const bucket = env.R2_MEDIA_BUCKET;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket)
      throw new Error(
        'MEDIA_STORE=r2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_MEDIA_BUCKET',
      );
    return r2MediaStore({ accountId, accessKeyId, secretAccessKey, bucket });
  }
  if (which === 'postgres') {
    if (env.VERCEL_ENV === 'production')
      throw new Error('The Postgres media store is for development only; set MEDIA_STORE=r2 in production');
    return postgresMediaStore();
  }
  throw new Error(`Unknown MEDIA_STORE "${which}" (postgres or r2)`);
}

let configured: MediaStore | undefined;

/** Set the store for this process (composition roots and tests). */
export function setMediaStore(store: MediaStore): void {
  configured = store;
}

/** The configured store, or the one the environment describes. */
export function mediaStore(): MediaStore {
  configured ??= mediaStoreFromEnv(process.env);
  return configured;
}
