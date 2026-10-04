import { requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NETWORK_EMBEDDING_DIMENSIONS, networkEmbeddings, networkProfiles } from '../schema.ts';
import { eventOf } from '../state.ts';
import { relationsTx, toPerson } from './attendee.ts';
import { PersonDto } from './dto.ts';
import { activeProfilesTx, blockedWithTx, listed, memberOf, type ProfileRow, viewerTx } from './state.ts';

/**
 * M6.12b matchmaking for networking (opt-in profiles only). The AI module embeds listed profiles
 * through its port (charged to the org's credits) and stores the vectors here; suggestions are an
 * exact cosine search among the event's listed, attending people the viewer may see. Opting out,
 * being hidden, editing the profile or erasure deletes the embedding (`dropEmbeddingTx`), and the
 * search re-checks both sides are listed, so someone not opted in is never suggested.
 */

/** The text a profile is embedded from: its public fields, never the name or the email. */
export function profileEmbeddingText(
  p: Pick<ProfileRow, 'headline' | 'company' | 'bio' | 'interests'>,
): string {
  return [p.headline, p.company, p.interests.join(', '), p.bio].filter((x) => x && x.length > 0).join('\n');
}

const listedWhere = (eventId: string) =>
  and(
    eq(networkProfiles.eventId, eventId),
    eq(networkProfiles.optedIn, true),
    isNull(networkProfiles.hiddenAt),
  );

export const MATCH_BATCH = 64;

export const PendingEmbeddingsDto = z.object({
  /** Listed profiles of the event still without an embedding. */
  pending: z.number().int(),
  items: z.array(z.object({ profileId: z.uuid(), text: z.string() })),
});
export type PendingEmbeddingsDto = z.infer<typeof PendingEmbeddingsDto>;

/** Listed, attending profiles of the event that have no embedding yet (a batch of their texts). */
export const pendingEmbeddingsQuery = tenantQuery({
  name: 'engagement.pendingEmbeddings',
  input: z.object({ eventId: z.uuid(), limit: z.int().min(1).max(MATCH_BATCH).default(MATCH_BATCH) }),
  output: PendingEmbeddingsDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    await eventOf(tx, input.eventId);
    const rows = await tx
      .select({ p: networkProfiles })
      .from(networkProfiles)
      .leftJoin(
        networkEmbeddings,
        and(
          eq(networkEmbeddings.orgId, networkProfiles.orgId),
          eq(networkEmbeddings.profileId, networkProfiles.id),
        ),
      )
      .where(and(listedWhere(input.eventId), isNull(networkEmbeddings.id)))
      .orderBy(asc(networkProfiles.optedInAt), asc(networkProfiles.id));
    const active = await activeProfilesTx(
      tx,
      input.eventId,
      rows.map((r) => r.p),
    );
    return {
      pending: active.length,
      items: active.slice(0, input.limit).map((p) => ({ profileId: p.id, text: profileEmbeddingText(p) })),
    };
  },
});

const Embedding = z
  .array(z.number().finite())
  .length(NETWORK_EMBEDDING_DIMENSIONS)
  .refine((v) => v.some((x) => x !== 0), 'zero vector');

/**
 * Store embeddings for profiles of one event. A profile that stopped being listed meanwhile (opted
 * out, hidden) or belongs to another event is skipped, never stored.
 */
export const storeEmbeddingsCommand = tenantCommand({
  name: 'engagement.storeEmbeddings',
  input: z.object({
    eventId: z.uuid(),
    model: z.string().trim().min(1).max(80),
    items: z
      .array(z.object({ profileId: z.uuid(), embedding: Embedding }))
      .min(1)
      .max(MATCH_BATCH),
  }),
  output: z.object({ stored: z.int(), skipped: z.int() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const ids = input.items.map((i) => i.profileId);
    const profiles = await tx
      .select()
      .from(networkProfiles)
      .where(and(inArray(networkProfiles.id, ids), listedWhere(input.eventId)))
      .for('update');
    const ok = new Set(profiles.map((p) => p.id));
    let stored = 0;
    for (const item of input.items) {
      if (!ok.has(item.profileId)) continue;
      await tx
        .insert(networkEmbeddings)
        .values({
          orgId: requireOrg(ctx),
          eventId: input.eventId,
          profileId: item.profileId,
          embedding: item.embedding,
          model: input.model,
        })
        .onConflictDoUpdate({
          target: [networkEmbeddings.orgId, networkEmbeddings.profileId],
          set: { embedding: item.embedding, model: input.model, updatedAt: ctx.now },
        });
      stored += 1;
    }
    return { stored, skipped: input.items.length - stored };
  },
  audit: (input, res) => ({
    action: 'engagement.network.embeddings_store',
    targetType: 'event',
    targetId: input.eventId,
    data: { stored: res.stored, skipped: res.skipped, model: input.model },
  }),
});

export const MatchmakingStatusDto = z.object({
  /** People listed in the directory right now. */
  listed: z.int(),
  /** Of them, the ones with an embedding (suggestions are ready for them). */
  embedded: z.int(),
});
export type MatchmakingStatusDto = z.infer<typeof MatchmakingStatusDto>;

export const matchmakingStatusQuery = tenantQuery({
  name: 'engagement.matchmakingStatus',
  input: z.object({ eventId: z.uuid() }),
  output: MatchmakingStatusDto,
  entitlement: 'sessions',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOf(tx, input.eventId);
    const [row] = await tx
      .select({
        listed: sql<number>`count(*)::int`,
        embedded: sql<number>`count(${networkEmbeddings.id})::int`,
      })
      .from(networkProfiles)
      .leftJoin(
        networkEmbeddings,
        and(
          eq(networkEmbeddings.orgId, networkProfiles.orgId),
          eq(networkEmbeddings.profileId, networkProfiles.id),
        ),
      )
      .where(listedWhere(input.eventId));
    return { listed: row?.listed ?? 0, embedded: row?.embedded ?? 0 };
  },
});

export const MatchDto = PersonDto.extend({
  /** 0–100: cosine similarity of the two profiles. */
  score: z.int().min(0).max(100),
  /** Interests both share (case-insensitive), to explain the suggestion. */
  shared: z.array(z.string()),
});
export type MatchDto = z.infer<typeof MatchDto>;
export const MatchesDto = z.object({
  /** False until the viewer's own profile has an embedding (the organizer refreshes them). */
  ready: z.boolean(),
  matches: z.array(MatchDto),
});
export type MatchesDto = z.infer<typeof MatchesDto>;

export const MAX_MATCHES = 10;

/**
 * "Suggested for you": the people of the same event closest to the viewer's profile. Both sides
 * must be listed (opted in, not hidden) and attending, with no block either way; people already
 * connected are left out.
 */
export const suggestedMatchesQuery = tenantQuery({
  name: 'engagement.suggestedMatches',
  input: z.object({
    eventId: z.uuid(),
    email: z.email().max(254),
    limit: z.int().min(1).max(MAX_MATCHES).default(5),
  }),
  output: MatchesDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const [mine] = await tx
      .select({ id: networkEmbeddings.id })
      .from(networkEmbeddings)
      .where(eq(networkEmbeddings.profileId, me.id));
    if (!mine) return { ready: false, matches: [] };
    const blocked = await blockedWithTx(tx, me.id);
    const candidates = await tx.execute<{ id: string; distance: number }>(sql`
      select p.id, (e.embedding operator(extensions.<=>) m.embedding)::float8 as distance
      from engagement.network_embeddings m
      join engagement.network_embeddings e on e.event_id = m.event_id and e.profile_id <> m.profile_id
      join engagement.network_profiles p on p.org_id = e.org_id and p.id = e.profile_id
      where m.profile_id = ${me.id} and p.event_id = ${input.eventId}
        and p.opted_in and p.hidden_at is null
      order by distance asc, p.id asc
      limit ${(input.limit + blocked.size) * 3 + 10}`);
    const ids = candidates.filter((c) => !blocked.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return { ready: true, matches: [] };
    const rows = await tx.select().from(networkProfiles).where(inArray(networkProfiles.id, ids));
    const active = new Map(
      (await activeProfilesTx(tx, input.eventId, rows)).filter(listed).map((p) => [p.id, p]),
    );
    const rel = await relationsTx(tx, me.id, [...active.keys()]);
    const myInterests = new Set(me.interests.map((i) => i.toLowerCase()));
    const matches: MatchDto[] = [];
    for (const c of candidates) {
      const p = active.get(c.id);
      const r = rel.get(c.id);
      if (!p || r?.connection === 'connected') continue;
      matches.push({
        ...toPerson(p, r),
        score: Math.max(0, Math.min(100, Math.round((1 - Number(c.distance)) * 100))),
        shared: p.interests.filter((i) => myInterests.has(i.toLowerCase())),
      });
      if (matches.length >= input.limit) break;
    }
    return { ready: true, matches };
  },
});
