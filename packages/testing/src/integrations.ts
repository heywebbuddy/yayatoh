import {
  beginConnectCommand,
  completeConnectCommand,
  demoFakeProvider,
  type FakeProvider,
  fakeAuthForConnectors,
  fakeIntegrations,
  type IntegrationAuth,
  slackFakeProvider,
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
  return connectFake(ctx, 'demo', demoFakeProvider);
}

/** M6.4c: connect Slack the same way (the fake workspace's channels, no network). */
export async function connectSlack(ctx: Ctx): Promise<{ connectionId: string; authConnectionId: string }> {
  return connectFake(ctx, 'slack', slackFakeProvider);
}

async function connectFake(
  ctx: Ctx,
  connector: string,
  provider: FakeProvider,
): Promise<{ connectionId: string; authConnectionId: string }> {
  const orgId = requireOrg(ctx);
  const { connectionId, state } = await executeCommand(beginConnectCommand, { connector }, ctx, ports);
  await fakeAuth.beginConnect({
    orgId,
    connectionId,
    providerConfigKey: connector,
    scopes: [],
    state,
    callbackUrl: '/callback',
  });
  fakeIntegrations.approve({ orgId, connectionId, providerConfigKey: connector }, provider);
  const resolved = await fakeAuth.resolve({ orgId, connectionId, providerConfigKey: connector });
  if (!resolved) throw new Error('fake connect did not resolve');
  await executeCommand(
    completeConnectCommand,
    { connectionId, state, authConnectionId: resolved.authConnectionId, accountLabel: resolved.accountLabel },
    ctx,
    ports,
  );
  return { connectionId, authConnectionId: resolved.authConnectionId };
}
