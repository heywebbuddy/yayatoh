import { closePools } from '@yayatoh/db';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  AGREEMENT_DOCUMENTS,
  acceptAgreementCommand,
  createOrganization,
  PLATFORM_AGREEMENTS,
  resolveOrgSlug,
} from '@yayatoh/tenancy';
import { getAuth } from '../../src/server/auth.ts';
import { ports } from '../../src/server/ports.ts';

/**
 * LOCAL ONLY: mirror the live demo target (org `webbuddy`, owner ratnesh@, attendee kartik@) on a
 * local database so scripts/demo-seed.ts can be tried before it runs on the live one.
 */
const host = new URL(process.env.DATABASE_URL ?? 'postgres://localhost').hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`local-prep refuses ${host}`);
const password = process.env.DEMO_LOCAL_PASSWORD ?? 'local-demo-password-1';

const auth = getAuth();
const ctx = await auth.$context;
const ids: Record<string, string> = {};
for (const email of ['ratnesh@webbuddy.agency', 'kartik@webbuddy.agency']) {
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  ids[email] = existing
    ? existing.user.id
    : (await auth.api.signUpEmail({ body: { email, password, name: '' } })).user.id;
}
const ownerId = ids['ratnesh@webbuddy.agency'] as string;
let org = await resolveOrgSlug('webbuddy');
if (!org) {
  const created = await createOrganization(
    createCtx({ actor: { type: 'user', userId: ownerId }, stepUpAt: new Date() }),
    { slug: 'webbuddy', name: 'WebBuddy', defaultProfile: 'agency' },
    ports,
  );
  org = { orgId: created.id } as unknown as typeof org;
}
const orgId = (org as { orgId: string }).orgId;
for (const document of AGREEMENT_DOCUMENTS)
  await executeCommand(
    acceptAgreementCommand,
    { document, version: PLATFORM_AGREEMENTS[document].version },
    createCtx({ orgId, actor: { type: 'user', userId: ownerId } }),
    ports,
  ).catch(() => undefined);
console.info(`local-prep: webbuddy ${orgId}, owner ${ownerId}`);
await closePools();
