import { type ContactReferenceOwner, participationEventIdsTx } from '@yayatoh/crm';
import { refreshParticipationTx } from './projector.ts';

/**
 * Contact merges (M6.1a, ADR 0022): after every module moved its rows (this owner runs in the
 * `projections` phase), the participation projection is recomputed for both records at every
 * event either took part in, from the sources, in the merge's transaction. Moves nothing itself.
 */
export const participationContactOwner: ContactReferenceOwner = {
  module: 'audiences',
  columns: [],
  phase: 'projections',
  move: async (tx, ctx, step) => {
    await recompute(tx, ctx, [step.fromContactId, step.toContactId]);
    return { moved: [] };
  },
  restore: async (tx, ctx, step) => {
    await recompute(tx, ctx, [step.fromContactId, step.toContactId]);
    return [];
  },
};

async function recompute(
  tx: Parameters<ContactReferenceOwner['move']>[0],
  ctx: Parameters<ContactReferenceOwner['move']>[1],
  contactIds: string[],
) {
  for (const eventId of await participationEventIdsTx(tx, contactIds))
    await refreshParticipationTx(tx, ctx, eventId, contactIds);
}
