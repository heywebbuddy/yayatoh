import { saveSegmentCommand } from '@yayatoh/audiences';
import { recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { ports } from './ports.ts';

export interface CampaignContactSeed {
  readonly email: string;
  readonly name: string;
  /** Email marketing consent in the crm ledger (null: none recorded). */
  readonly consent: 'granted' | 'withdrawn' | null;
}

/**
 * M3.6b browser journeys: crm contacts with (or without) email marketing consent, and a saved
 * audience "Everyone" (no conditions) to send a campaign to. Returns the audience id.
 */
export async function campaignScenario(
  orgId: string,
  people: readonly CampaignContactSeed[],
  audienceName = 'Everyone',
): Promise<string> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'e2e.campaigns' } });
  await withTenant(ctx, async (tx) => {
    for (const p of people) {
      const { id } = await upsertContactTx(tx, ctx, { email: p.email, name: p.name, source: 'manual' });
      if (p.consent)
        await recordConsentTx(tx, ctx, {
          contactId: id,
          channel: 'email',
          purpose: 'marketing',
          status: p.consent,
          evidence: 'e2e: checkout opt-in',
        });
    }
  });
  const seg = await executeCommand(
    saveSegmentCommand,
    { name: audienceName, definition: { version: 1, root: { type: 'group', op: 'and', conditions: [] } } },
    ctx,
    ports,
  );
  return seg.id;
}
