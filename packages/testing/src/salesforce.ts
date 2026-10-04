import {
  beginConnectCommand,
  completeConnectCommand,
  fakeIntegrations,
  salesforceFakeProvider,
} from '@yayatoh/integrations';
import { type Ctx, executeCommand, requireOrg } from '@yayatoh/kernel';
import { fakeAuth } from './integrations.ts';
import { ports } from './ports.ts';

/**
 * Connect Salesforce (M6.5b) as the console does, against the fake org: begin, the fake consent
 * screen's Allow, resolve through the port, complete (default mappings, first sync queued).
 */
export async function connectSalesforce(
  ctx: Ctx,
): Promise<{ connectionId: string; authConnectionId: string }> {
  const orgId = requireOrg(ctx);
  const { connectionId, state } = await executeCommand(
    beginConnectCommand,
    { connector: 'salesforce' },
    ctx,
    ports,
  );
  fakeIntegrations.approve({ orgId, connectionId, providerConfigKey: 'salesforce' }, salesforceFakeProvider);
  const resolved = await fakeAuth.resolve({ orgId, connectionId, providerConfigKey: 'salesforce' });
  if (!resolved) throw new Error('fake Salesforce connect did not resolve');
  await executeCommand(
    completeConnectCommand,
    { connectionId, state, authConnectionId: resolved.authConnectionId, accountLabel: resolved.accountLabel },
    ctx,
    ports,
  );
  return { connectionId, authConnectionId: resolved.authConnectionId };
}
