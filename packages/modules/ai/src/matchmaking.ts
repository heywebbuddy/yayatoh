import type { TenantTx } from '@yayatoh/db';
import { MATCH_BATCH, pendingEmbeddingsQuery, storeEmbeddingsCommand } from '@yayatoh/engagement';
import { type CommandPorts, type Ctx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { z } from 'zod';
import { AiOutputError } from './domain/compose.ts';
import { EMBED_BATCH, EMBEDDING_DIMENSIONS, validEmbedding } from './domain/embed.ts';
import type { AiDrafter } from './drafter.ts';
import { chargedCall, eventCredits, withTimeout } from './spend.ts';

export const RefreshMatchmakingDto = z.object({
  /** Profiles embedded by this refresh. */
  embedded: z.number().int(),
  /** Provider calls made (one credit each). */
  calls: z.number().int(),
  /** Listed profiles still waiting (only when the batch limit stopped the refresh). */
  pending: z.number().int(),
  balance: z.number().int().nullable(),
});
export type RefreshMatchmakingDto = z.infer<typeof RefreshMatchmakingDto>;

/** At most this many provider calls per refresh (a big event finishes over a few refreshes). */
export const MAX_REFRESH_CALLS = 10;

/**
 * M6.12b: embed the event's listed networking profiles that have no embedding yet, in batches
 * (`EMBED_BATCH` per provider call, one credit per call), and store them through engagement's
 * command, which skips anyone who stopped being listed meanwhile. Only opted-in, visible,
 * attending profiles are ever sent: engagement chooses them. Nothing to embed costs nothing.
 */
export async function refreshMatchmaking(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  input: { eventId: string },
): Promise<RefreshMatchmakingDto> {
  const eventId = z.uuid().parse(input.eventId);
  if (!drafter) throw new DomainError('invalid_state', 'AI is off', { reason: 'ai_unavailable' });
  const limit = Math.min(EMBED_BATCH, MATCH_BATCH);
  let embedded = 0;
  let calls = 0;
  let balance: number | null = null;
  for (;;) {
    const batch = await executeQuery(pendingEmbeddingsQuery, { eventId, limit }, ctx, ports);
    if (batch.items.length === 0) return { embedded, calls, pending: 0, balance };
    if (calls >= MAX_REFRESH_CALLS) return { embedded, calls, pending: batch.pending, balance };
    const res = await chargedCall(ctx, ports, eventCredits, { purpose: 'embedding', eventId }, async () => {
      const vectors = await withTimeout(drafter.embed(batch.items.map((i) => i.text)));
      if (vectors.length !== batch.items.length || !vectors.every(validEmbedding))
        throw new AiOutputError(`embeddings (expected ${batch.items.length} × ${EMBEDDING_DIMENSIONS})`);
      return executeCommand(
        storeEmbeddingsCommand,
        {
          eventId,
          model: drafter.name,
          items: batch.items.map((i, n) => ({ profileId: i.profileId, embedding: vectors[n] as number[] })),
        },
        ctx,
        ports,
      );
    });
    calls += 1;
    balance = res.balance;
    embedded += res.value.stored;
    // Everyone in the batch was skipped (they all left meanwhile): stop rather than loop.
    if (res.value.stored === 0) return { embedded, calls, pending: 0, balance };
  }
}
