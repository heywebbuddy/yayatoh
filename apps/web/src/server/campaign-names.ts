import 'server-only';
import { campaignNamesQuery } from '@yayatoh/campaigns';
import { type Ctx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { ports } from './ports.ts';

/**
 * Batch 3g merge: marketing analytics (M3.8b) keys messaging campaigns by id (`c.{id}`) and, on
 * its own, names them after their tracked links' label. The campaigns module (M3.6b) is a higher
 * tier than marketing, so the web names them from M3.6b's public read: the campaign's current
 * name (a renamed campaign, or one without a link, still reads right).
 */
export async function campaignNames(ctx: Ctx, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  try {
    const rows = await executeQuery(campaignNamesQuery, { ids: unique }, ctx, ports);
    return new Map(rows.map((r) => [r.id, r.name]));
  } catch (err) {
    // A reader without `marketing:read` (deliverability needs `messages:read` only) keeps the
    // links' label.
    if (isDomainError(err) && ['forbidden', 'module_not_enabled'].includes(err.code)) return new Map();
    throw err;
  }
}

/** The rows with each messaging campaign (`kind: 'campaign'`, key `c.{id}`) named by M3.6b. */
export async function nameCampaignRows<T extends { key: string; kind: string; name: string | null }>(
  ctx: Ctx,
  rows: readonly T[],
): Promise<T[]> {
  const ids = rows.filter((r) => r.kind === 'campaign' && r.key.startsWith('c.')).map((r) => r.key.slice(2));
  const names = await campaignNames(ctx, ids);
  return rows.map((r) =>
    r.kind === 'campaign' && names.has(r.key.slice(2))
      ? { ...r, name: names.get(r.key.slice(2)) ?? r.name }
      : r,
  );
}
