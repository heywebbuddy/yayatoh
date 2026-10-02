import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { actorId, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { duplicateCandidates, duplicateScans } from '../schema.ts';
import { type DuplicateSignals, NAME_THRESHOLD, scoreDuplicate } from './domain.ts';

/** Live contacts only: never merged away, never erased. */
const LIVE = sql.raw(`merged_into is null and email_norm not like '%@erased.invalid'`);

/**
 * The SQL twin of `canonicalEmail` (domain.ts): no `+tag`, and for Gmail no dots. The unit test
 * of the TypeScript version documents the rule; the scan integration test pins both.
 */
const CANONICAL = sql.raw(`(
  case when split_part(email_norm, '@', 2) in ('gmail.com', 'googlemail.com')
    then replace(case when position('+' in split_part(email_norm, '@', 1)) > 1
                      then split_part(split_part(email_norm, '@', 1), '+', 1)
                      else split_part(email_norm, '@', 1) end, '.', '') || '@gmail.com'
    else (case when position('+' in split_part(email_norm, '@', 1)) > 1
               then split_part(split_part(email_norm, '@', 1), '+', 1)
               else split_part(email_norm, '@', 1) end) || '@' || split_part(email_norm, '@', 2)
  end)`);

const idList = (ids: readonly string[]) =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;

type Pair = { a: string; b: string } & { -readonly [K in keyof DuplicateSignals]: DuplicateSignals[K] };

/**
 * Find duplicate candidates in the caller's org (M6.1a): same canonical email, same phone, or a
 * similar name (pg_trgm ≥ 0.6) and company. Incremental by default: only contacts created or
 * changed since the last scan are compared with everyone (`full` compares everyone). Scores and
 * reasons of open candidates are refreshed; dismissed and merged pairs keep their status.
 */
export async function scanDuplicatesTx(
  tx: TenantTx,
  ctx: Ctx,
  opts: { full?: boolean } = {},
): Promise<{ scanned: number; found: number }> {
  const orgId = requireOrg(ctx);
  const [state] = await tx.select().from(duplicateScans).for('update');
  const full = opts.full === true || !state?.cursorAt;
  const [mark] = await tx.execute<{ max: string | Date | null }>(
    sql`select max(updated_at) as max from crm.contacts`,
  );
  const high = mark?.max ? new Date(mark.max) : null;
  let ids: string[] | null = null;
  if (!full) {
    const changed = await tx.execute<{ id: string }>(
      sql`select id from crm.contacts where updated_at >= ${(state?.cursorAt as Date).toISOString()}::timestamptz and ${LIVE}`,
    );
    ids = changed.map((r) => r.id);
  }
  const scanned = ids === null ? Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from crm.contacts where ${LIVE}`))[0]?.n ?? 0) : ids.length;

  const pairs = new Map<string, Pair>();
  const pair = (x: string, y: string): Pair => {
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}:${b}`;
    let p = pairs.get(key);
    if (!p) {
      p = { a, b, sameEmail: false, samePhone: false, nameSimilarity: null, companySimilarity: null };
      pairs.set(key, p);
    }
    return p;
  };
  if (ids === null || ids.length > 0) {
    const involve = (col: string) =>
      ids === null ? sql`true` : sql`(${sql.raw(col)} = any(${idList(ids)}))`;
    const emails = await tx.execute<{ a: string; b: string }>(sql`
      with c as (select id, ${CANONICAL} as canon from crm.contacts where ${LIVE})
      select x.id as a, y.id as b from c x join c y on y.canon = x.canon and y.id > x.id
      where ${involve('x.id')} or ${involve('y.id')}`);
    for (const r of emails) pair(r.a, r.b).sameEmail = true;
    const phones = await tx.execute<{ a: string; b: string }>(sql`
      with c as (select id, phone_e164 from crm.contacts where phone_e164 is not null and ${LIVE})
      select x.id as a, y.id as b from c x join c y on y.phone_e164 = x.phone_e164 and y.id > x.id
      where ${involve('x.id')} or ${involve('y.id')}`);
    for (const r of phones) pair(r.a, r.b).samePhone = true;
    const names = await tx.execute<{ a: string; b: string; name_sim: number; company_sim: number | null }>(
      sql`select a, b, name_sim, company_sim from crm.similar_contact_pairs(${ids === null ? null : idList(ids)}, ${NAME_THRESHOLD})`,
    );
    for (const r of names) {
      const p = pair(r.a, r.b);
      p.nameSimilarity = Number(r.name_sim);
      p.companySimilarity = r.company_sim === null ? null : Number(r.company_sim);
    }
  }

  let found = 0;
  for (const p of pairs.values()) {
    const s = scoreDuplicate(p);
    if (!s) continue;
    found += 1;
    const pct = (v: number | null) => (v === null ? null : Math.round(v * 100));
    await tx
      .insert(duplicateCandidates)
      .values({
        orgId,
        contactAId: p.a,
        contactBId: p.b,
        score: s.score,
        reasons: [...s.reasons],
        nameSimilarity: pct(p.nameSimilarity),
        companySimilarity: pct(p.companySimilarity),
        status: 'open',
        detectedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: [duplicateCandidates.orgId, duplicateCandidates.contactAId, duplicateCandidates.contactBId],
        set: {
          score: s.score,
          reasons: [...s.reasons],
          nameSimilarity: pct(p.nameSimilarity),
          companySimilarity: pct(p.companySimilarity),
          updatedAt: ctx.now,
        },
        setWhere: sql`${duplicateCandidates.status} = 'open'`,
      });
  }
  const values = {
    cursorAt: high ?? state?.cursorAt ?? null,
    lastRunAt: ctx.now,
    contactsScanned: scanned,
    pairsFound: found,
    updatedAt: ctx.now,
    ...(full ? { lastFullAt: ctx.now } : {}),
  };
  if (state) await tx.update(duplicateScans).set(values).where(eq(duplicateScans.id, state.id));
  else await tx.insert(duplicateScans).values({ orgId, ...values });
  return { scanned, found };
}

export const ScanResultDto = z.object({ scanned: z.int(), found: z.int() });
export const scanResultSerializer = defineSerializer('crm.scanResult', ScanResultDto);

/** "Look for duplicates now" (the same work as the background job, M6.1a). */
export const scanDuplicatesCommand = tenantCommand({
  name: 'crm.scanDuplicates',
  input: z.object({ full: z.boolean().default(false) }),
  output: ScanResultDto,
  entitlement: 'marketing',
  permission: 'contacts:merge',
  handler: async ({ input, ctx, tx }) => scanResultSerializer.serialize(await scanDuplicatesTx(tx, ctx, input)),
  audit: (input, r) => ({
    action: 'crm.scanDuplicates',
    targetType: 'org',
    targetId: null,
    data: { full: input.full, scanned: r.scanned, found: r.found },
  }),
});

/** "Not the same person": the pair is never raised again. */
export const dismissDuplicateCommand = tenantCommand({
  name: 'crm.dismissDuplicate',
  input: z.object({ candidateId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'marketing',
  permission: 'contacts:merge',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(duplicateCandidates)
      .set({ status: 'dismissed', resolvedAt: ctx.now, resolvedBy: actorId(ctx.actor), updatedAt: ctx.now })
      .where(and(eq(duplicateCandidates.id, input.candidateId), eq(duplicateCandidates.status, 'open')))
      .returning({ id: duplicateCandidates.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { ok: true as const };
  },
  audit: (input) => ({ action: 'crm.dismissDuplicate', targetType: 'duplicate_candidate', targetId: input.candidateId }),
});
