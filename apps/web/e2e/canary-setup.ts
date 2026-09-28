import { mkdirSync, writeFileSync } from 'node:fs';
import { closePools } from '@yayatoh/db';
import { adminClient } from '@yayatoh/db/testing';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { canaryOrg } from '@yayatoh/testing';

/**
 * Builds (or refills) the canary org in the e2e database and writes its handles, exports and
 * captured outbound messages to e2e/.generated/canary.json for canary-crawl.spec.ts (roadmap §9).
 * Run by the global setup; needs ADMIN_DATABASE_URL, DATABASE_URL and LOCAL_KMS_KEY (sealed
 * canaries must open under the web server's key).
 */
const kms = process.env.LOCAL_KMS_KEY;
if (!kms) throw new Error('LOCAL_KMS_KEY is not set');
setKeyVault(localKeyVault(kms));
const admin = adminClient();
try {
  const org = await canaryOrg({ admin, slug: 'canary-leaks', reuse: true });
  const dir = new URL('./.generated/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('canary.json', dir), `${JSON.stringify(org, null, 2)}\n`);
  console.log(`canary org ${org.slug}: ${Object.keys(org.filled).length} private columns filled`);
} finally {
  await admin.end();
  await closePools();
}
