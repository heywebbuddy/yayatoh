import { closePools } from '@yayatoh/db';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { addMemberCommand, createOrganization, resolveOrgSlug } from '@yayatoh/tenancy';
import { PERSONAS, SEED_ORGS } from '../src/server/personas.ts';
import { ports } from '../src/server/ports.ts';

// Local/preview seed with the dev personas. Never runs against production (CLAUDE.md → Safety).
const host = new URL(process.env.DATABASE_URL ?? 'postgres://localhost').hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host) && !process.env.SEED_ALLOW_PREVIEW) {
  throw new Error(`Refusing to seed ${host}; set SEED_ALLOW_PREVIEW=1 for a preview branch database`);
}

for (const o of SEED_ORGS) {
  if (await resolveOrgSlug(o.slug)) {
    console.info(`seed: ${o.slug} exists`);
    continue;
  }
  const [owner, ...others] = PERSONAS.filter((p) => p.orgSlug === o.slug);
  if (!owner) continue;
  const ownerCtx = createCtx({ actor: { type: 'user', userId: owner.userId } });
  const org = await createOrganization(
    ownerCtx,
    { slug: o.slug, name: o.name, defaultProfile: o.profile },
    ports,
  );
  for (const p of others) {
    await executeCommand(
      addMemberCommand,
      { userId: p.userId, role: p.role },
      { ...ownerCtx, orgId: org.id },
      ports,
    );
  }
  console.info(`seed: created ${o.slug}`);
}
await closePools();
