import { withdrawEmailMarketingTx, writeSyncedContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { suppressAddressFromIntegrationTx, suppressFromIntegrationTx } from '@yayatoh/notifications';
import { consentChanges } from '../schema.ts';
import type { InboundChange } from './consent.ts';

/** The connectors whose unsubscribes become suppressions (their key is the suppression source). */
export type MarketingConnectorKey = 'mailchimp' | 'klaviyo' | 'hubspot';

/**
 * Apply what a provider says about a person (M6.4d), inside the pull's savepoint:
 * - `unsubscribed`: email marketing consent withdrawn (evidence `integration:<connector>:<connection>`)
 *   and the address on the marketing unsubscribe list with the provider as source;
 * - `complained`: the same, plus an address suppression (`complaint`);
 * - `cleaned`: an address suppression (`hard_bounce`); consent is left as it is.
 * A person we did not know becomes a contact (`import`) without consent, so the suppression is
 * honoured if they ever register. Recorded once per provider record and version in
 * `consent_changes`. Returns the contact id.
 */
export async function applyInboundChangeTx(
  tx: TenantTx,
  ctx: Ctx,
  input: {
    readonly connector: MarketingConnectorKey;
    readonly connectionId: string;
    readonly contactId: string | null;
    readonly email: string;
    readonly change: InboundChange;
    readonly externalId: string;
    readonly remoteVersion: string;
  },
): Promise<string> {
  const orgId = requireOrg(ctx);
  const contactId = await writeSyncedContactTx(tx, ctx, {
    contactId: input.contactId,
    email: input.email,
    name: null,
  });
  const evidence = `integration:${input.connector}:${input.connectionId}`;
  let consentWithdrawn = false;
  let suppressed = false;
  if (input.change === 'unsubscribed' || input.change === 'complained') {
    consentWithdrawn = await withdrawEmailMarketingTx(tx, ctx, contactId, evidence);
    suppressed = await suppressFromIntegrationTx(tx, orgId, input.email, input.connector);
  }
  if (input.change === 'complained' || input.change === 'cleaned')
    suppressed =
      (await suppressAddressFromIntegrationTx(
        tx,
        orgId,
        input.email,
        input.change === 'cleaned' ? 'hard_bounce' : 'complaint',
      )) || suppressed;
  await tx
    .insert(consentChanges)
    .values({
      orgId,
      connectionId: input.connectionId,
      contactId,
      change: input.change,
      externalId: input.externalId.slice(0, 255),
      remoteVersion: input.remoteVersion.slice(0, 255),
      consentWithdrawn,
      suppressed,
    })
    .onConflictDoNothing();
  return contactId;
}
