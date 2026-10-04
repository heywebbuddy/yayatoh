import {
  beginConnectCommand,
  completeConnectCommand,
  connectionDetailQuery,
  connectorByKey,
  demoRemoteUpdate,
  disconnectCommand,
  fakeIntegrations,
  listConnectionsQuery,
  runDueSyncs,
} from '@yayatoh/integrations';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/server/auth.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M6.x, k6 `sync-throughput.js`): connect the demo connector for a seeded org as its
 * owner, fill the fake provider with `records` contacts, and (`action=run`) drain the org's due
 * syncs, answering the counts. Load tooling, not a feature: 404 unless dev auth is on and the port
 * is the fake; only the seeded `lakeside-events` org and its owner; answers ids and counts only.
 */
const OWNER = 'pani@lakeside.test';
const MAX_RECORDS = 5000;

export async function POST(req: NextRequest) {
  const auth = integrationAuth();
  if (!devAuthEnabled() || auth?.provider !== 'fake') return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const org = await resolveOrgSlug('lakeside-events');
  const owner = await (await getAuth().$context).internalAdapter.findUserByEmail(OWNER);
  if (!org || !owner) return NextResponse.json({ error: 'run_pnpm_seed' }, { status: 409 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'user', userId: owner.user.id } });
  const def = connectorByKey('demo');
  if (!def?.fake) return NextResponse.json({ error: 'no_demo_connector' }, { status: 409 });

  if (form.get('action') === 'run') {
    const connectionId = String(form.get('connection') ?? '');
    const started = Date.now();
    const runs = await runDueSyncs(org.orgId, { auth }, ports);
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, ctx, ports);
    const run = detail.runs[0];
    return NextResponse.json({
      ms: Date.now() - started,
      runs: runs.length,
      status: run?.status ?? null,
      pulled: run?.pulled ?? 0,
      failed: run?.failed ?? 0,
    });
  }

  const records = Math.min(MAX_RECORDS, Math.max(0, Number(form.get('records') ?? 0) | 0));
  const existing = (await executeQuery(listConnectionsQuery, {}, ctx, ports)).find(
    (c) => c.connector === 'demo' && ['pending', 'active', 'paused'].includes(c.status),
  );
  if (existing) await executeCommand(disconnectCommand, { connectionId: existing.id }, ctx, ports);
  const begun = await executeCommand(beginConnectCommand, { connector: 'demo' }, ctx, ports);
  const authConnectionId = fakeIntegrations.approve(
    { orgId: org.orgId, connectionId: begun.connectionId, providerConfigKey: def.providerConfigKey },
    def.fake,
  );
  const account = fakeIntegrations.account(authConnectionId);
  if (!account) return NextResponse.json({ error: 'no_account' }, { status: 500 });
  for (let i = 0; i < records; i++)
    demoRemoteUpdate(account, `load_${i}`, {
      email_address: `load.${i}@demo-remote.test`,
      full_name: `Load Contact ${i}`,
      company: 'Load',
    });
  await executeCommand(
    completeConnectCommand,
    { connectionId: begun.connectionId, state: begun.state, authConnectionId, accountLabel: null },
    ctx,
    ports,
  );
  return NextResponse.json({ connectionId: begun.connectionId, records });
}
