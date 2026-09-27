import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { createOrgFixture } from '../src/fixtures.ts';

// Local/preview seed. Never runs against production (CLAUDE.md → Safety).
const host = new URL(process.env.DATABASE_URL ?? 'postgres://localhost').hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host) && !process.env.SEED_ALLOW_PREVIEW) {
  throw new Error(`Refusing to seed ${host}; set SEED_ALLOW_PREVIEW=1 for a preview branch database`);
}

for (const [slug, name] of [
  ['alpha-events', 'Alpha Events'],
  ['bravo-weddings', 'Bravo Weddings'],
] as const) {
  if (await resolveOrgSlug(slug)) {
    console.info(`seed: ${slug} exists`);
    continue;
  }
  const f = await createOrgFixture(slug, name);
  console.info(`seed: created ${slug} (${f.org.id}), owner ${f.ownerId}`);
}
await closePools();
