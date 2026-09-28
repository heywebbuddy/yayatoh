import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Before the suite: migrate the synthetic legacy dataset (M2.2b) into the e2e database, as the
 * owner's migration would, and write the handles the legacy-migration spec reads
 * (e2e/.generated/legacy-demo.json). Idempotent: a rerun on a used database changes nothing.
 * Needs MIGRATOR_DATABASE_URL, DATABASE_URL and LOCAL_KMS_KEY (the same env the seed uses).
 */
export default function globalSetup() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const missing = ['MIGRATOR_DATABASE_URL', 'DATABASE_URL', 'LOCAL_KMS_KEY'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(`e2e: skipping the legacy demo migration (${missing.join(', ')} not set)`);
    return;
  }
  const r = spawnSync(process.execPath, ['tools/legacy-migrate/cli.ts', 'demo'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`migrate:legacy:demo failed:\n${r.stdout}\n${r.stderr}`);
}
