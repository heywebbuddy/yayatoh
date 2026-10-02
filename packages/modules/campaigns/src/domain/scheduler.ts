/**
 * The fair campaign scheduler (M3.6b). Campaign messages never flood the notifications queue:
 * every tick the leader hands out a bounded number of recipients (`capacity`) to the running
 * campaigns, **round-robin across orgs** in chunks, each org limited by its own per-minute rate
 * (from its messaging quota). So an org sending 50,000 gets the same turn as an org sending 100,
 * and whatever an org's campaigns release is at most one chunk ahead of its transactional mail in
 * the dispatcher. Pure: the worker and the tests (time-compressed) run the same function.
 */

export interface OrgLane {
  readonly orgId: string;
  /** Recipients this org may still release in the current minute (its rate minus what it released). */
  readonly budget: number;
  /** The org's running campaigns with recipients still pending, oldest first. */
  readonly campaigns: readonly { readonly campaignId: string; readonly pending: number }[];
}

export interface Allocation {
  readonly orgId: string;
  readonly campaignId: string;
  readonly size: number;
}

export interface SchedulerOptions {
  /** Recipients released per tick across all orgs. */
  readonly capacity: number;
  /** Recipients per turn (one pg-boss job releases at most one allocation). */
  readonly chunk: number;
  /** Rotates which org goes first, so ties don't always favour the same org. */
  readonly tick?: number;
}

export const DEFAULT_SCHEDULER: Required<Omit<SchedulerOptions, 'tick'>> = { capacity: 500, chunk: 50 };

/** Per-org rate per minute from its monthly quota for the channel: a tenth, within 30–2,000. */
export function ratePerMinute(monthlyLimit: number): number {
  return Math.min(2_000, Math.max(30, Math.ceil(monthlyLimit / 10)));
}

export function allocate(lanes: readonly OrgLane[], opts: SchedulerOptions): Allocation[] {
  const chunk = Math.max(1, Math.floor(opts.chunk));
  let capacity = Math.max(0, Math.floor(opts.capacity));
  const active = lanes
    .filter((l) => l.budget > 0 && l.campaigns.some((c) => c.pending > 0))
    .sort((a, b) => (a.orgId < b.orgId ? -1 : a.orgId > b.orgId ? 1 : 0));
  if (active.length === 0 || capacity === 0) return [];
  const start = (opts.tick ?? 0) % active.length;
  const order = [...active.slice(start), ...active.slice(0, start)];
  const state = order.map((l) => ({
    orgId: l.orgId,
    budget: Math.floor(l.budget),
    next: 0,
    campaigns: l.campaigns
      .filter((c) => c.pending > 0)
      .map((c) => ({ ...c, pending: Math.floor(c.pending) })),
  }));
  const out = new Map<string, { orgId: string; campaignId: string; size: number }>();
  let progress = true;
  while (capacity > 0 && progress) {
    progress = false;
    for (const org of state) {
      if (capacity === 0) break;
      if (org.budget === 0) continue;
      // The org's campaigns take turns too (round-robin inside the org).
      const open = org.campaigns.filter((c) => c.pending > 0);
      if (open.length === 0) continue;
      const c = open[org.next % open.length];
      if (!c) continue;
      org.next += 1;
      const size = Math.min(chunk, org.budget, capacity, c.pending);
      if (size <= 0) continue;
      c.pending -= size;
      org.budget -= size;
      capacity -= size;
      const prev = out.get(c.campaignId);
      out.set(c.campaignId, { orgId: org.orgId, campaignId: c.campaignId, size: (prev?.size ?? 0) + size });
      progress = true;
    }
  }
  return [...out.values()];
}
