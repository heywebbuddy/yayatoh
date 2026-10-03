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
  const orgId = requireOrg(ctx);
  const { connectionId, state } = await executeCommand(
    beginConnectCommand,
    { connector: 'demo' },
    ctx,
    ports,
  );
  await fakeAuth.beginConnect({
    orgId,
    connectionId,
    providerConfigKey: 'demo',
    scopes: [],
    state,
    callbackUrl: '/callback',
  });
  fakeIntegrations.approve({ orgId, connectionId, providerConfigKey: 'demo' }, demoFakeProvider);
  const resolved = await fakeAuth.resolve({ orgId, connectionId, providerConfigKey: 'demo' });
  if (!resolved) throw new Error('fake connect did not resolve');
  await executeCommand(
    completeConnectCommand,
    { connectionId, state, authConnectionId: resolved.authConnectionId, accountLabel: resolved.accountLabel },
    ctx,
    ports,
  );
  return { connectionId, authConnectionId: resolved.authConnectionId };
}

/**
 * M6.4d: connect any connector through the fake port as the console does (Mailchimp, Klaviyo,
 * HubSpot …), with that connector's fake provider API.
 */
export async function connectFake(
  ctx: Ctx,
  connector: string,
): Promise<{ connectionId: string; authConnectionId: string }> {
  const def = connectorByKey(connector);
  if (!def?.fake) throw new Error(`no fake for ${connector}`);
  const orgId = requireOrg(ctx);
  const { connectionId, state } = await executeCommand(beginConnectCommand, { connector }, ctx, ports);
  fakeIntegrations.approve({ orgId, connectionId, providerConfigKey: def.providerConfigKey }, def.fake);
  const resolved = await fakeAuth.resolve({ orgId, connectionId, providerConfigKey: def.providerConfigKey });
  if (!resolved) throw new Error('fake connect did not resolve');
  await executeCommand(
    completeConnectCommand,
    { connectionId, state, authConnectionId: resolved.authConnectionId, accountLabel: resolved.accountLabel },
    ctx,
    ports,
  );
  return { connectionId, authConnectionId: resolved.authConnectionId };
}
