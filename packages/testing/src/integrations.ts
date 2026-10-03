import {
  beginConnectCommand,
  completeConnectCommand,
  connectorByKey,
  demoFakeProvider,
  fakeAuthForConnectors,
  fakeIntegrations,
  type IntegrationAuth,
} from '@yayatoh/integrations';
import { type Ctx, executeCommand, requireOrg } from '@yayatoh/kernel';
import { ports } from './ports.ts';

/** The fake `IntegrationAuth` the apps use in dev and CI (M6.4a), with every connector's fake API. */
export const fakeAuth: IntegrationAuth = fakeAuthForConnectors();

/**
 * Connect the demo connector as the console does: begin (pending + state), the fake consent
 * screen's Allow, resolve through the port, complete (default mappings, first sync queued).
 */
export async function connectDemo(ctx: Ctx): Promise<{ connectionId: string; authConnectionId: string }> {
  return connectConnector(ctx, 'demo');
}

/** M6.4c: connect Slack the same way (the fake workspace's channels, no network). */
export async function connectSlack(ctx: Ctx): Promise<{ connectionId: string; authConnectionId: string }> {
  return connectConnector(ctx, 'slack');
}

/** Connect any connector through its fake provider (M6.4b: `eventbrite`, `google_sheets`). */
export async function connectConnector(
  ctx: Ctx,
  key: string,
): Promise<{ connectionId: string; authConnectionId: string }> {
  const orgId = requireOrg(ctx);
  const def = connectorByKey(key);
  if (!def?.fake) throw new Error(`no fake for connector ${key}`);
  const providerConfigKey = def.providerConfigKey;
  const { connectionId, state } = await executeCommand(beginConnectCommand, { connector: key }, ctx, ports);
  await fakeAuth.beginConnect({
    orgId,
    connectionId,
    providerConfigKey,
    scopes: [],
    state,
    callbackUrl: '/callback',
  });
  fakeIntegrations.approve(
    { orgId, connectionId, providerConfigKey },
    key === 'demo' ? demoFakeProvider : def.fake,
  );
  const resolved = await fakeAuth.resolve({ orgId, connectionId, providerConfigKey });
  if (!resolved) throw new Error('fake connect did not resolve');
  await executeCommand(
    completeConnectCommand,
    { connectionId, state, authConnectionId: resolved.authConnectionId, accountLabel: resolved.accountLabel },
    ctx,
    ports,
  );
  return { connectionId, authConnectionId: resolved.authConnectionId };
}
