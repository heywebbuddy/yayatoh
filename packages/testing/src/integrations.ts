import {
  type AccountMap,
  beginConnectCommand,
  completeConnectCommand,
  connectorByKey,
  demoFakeProvider,
  type FakeProvider,
  fakeAuthForConnectors,
  fakeIntegrations,
  type IntegrationAuth,
  type ProviderAccount,
  QUICKBOOKS_FAKE_ACCOUNTS,
  quickbooksConnector,
  XERO_FAKE_ACCOUNTS,
  xeroConnector,
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

/**
 * M6.5d: connect an accounting connector (`quickbooks`, `xero`) through the fake port as the
 * console does. Returns the connection and the fake provider-side account id.
 */
export async function connectAccounting(
  ctx: Ctx,
  connector: 'quickbooks' | 'xero',
): Promise<{ connectionId: string; authConnectionId: string }> {
  const orgId = requireOrg(ctx);
  const def = connector === 'quickbooks' ? quickbooksConnector : xeroConnector;
  const { connectionId, state } = await executeCommand(beginConnectCommand, { connector }, ctx, ports);
  fakeIntegrations.approve(
    { orgId, connectionId, providerConfigKey: def.providerConfigKey },
    def.fake as FakeProvider,
  );
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

/** The fake books' sensible mapping (clearing asset, bank, income, refunds, fees). */
export function fakeAccountMap(connector: 'quickbooks' | 'xero'): AccountMap {
  const pick = (id: string): ProviderAccount => {
    if (connector === 'quickbooks') {
      const a = QUICKBOOKS_FAKE_ACCOUNTS.find((x) => x.Id === id);
      if (!a) throw new Error(`no fake account ${id}`);
      return { id: a.Id, code: a.AcctNum, name: a.Name, type: a.AccountType };
    }
    const a = XERO_FAKE_ACCOUNTS.find((x) => x.AccountID === id);
    if (!a) throw new Error(`no fake account ${id}`);
    return { id: a.AccountID, code: a.Code, name: a.Name, type: a.Type };
  };
  return connector === 'quickbooks'
    ? {
        sales: pick('79'),
        donations: pick('80'),
        refunds: pick('81'),
        fees: pick('92'),
        payouts: pick('35'),
        clearing: pick('36'),
      }
    : {
        sales: pick('a1b2-200'),
        donations: pick('a1b2-260'),
        refunds: pick('a1b2-210'),
        fees: pick('a1b2-404'),
        payouts: pick('a1b2-090'),
        clearing: pick('a1b2-610'),
      };
}
