/**
 * Sync rules (M6.4a), pure and browser-safe: statuses, retry backoff and the loop guard's
 * decisions. The engine (`engine.ts`) applies them; the console shows the same vocabularies.
 */

export const CONNECTION_STATUSES = ['pending', 'active', 'paused', 'revoked', 'failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
/** Connections that hold the connector's one live slot per org. */
export const LIVE_STATUSES = ['pending', 'active', 'paused'] as const satisfies readonly ConnectionStatus[];

export const RUN_TRIGGERS = ['manual', 'schedule', 'retry'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
/** A run that holds the connection (concurrency of one). */
export const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const satisfies readonly RunStatus[];

/** Where in a sync an error happened (the errors inbox groups by it). */
export const ERROR_STEPS = ['auth', 'pull', 'map', 'write', 'push', 'conflict'] as const;
export type ErrorStep = (typeof ERROR_STEPS)[number];
export const ERROR_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

/**
 * M6.4b: a linked record that disappeared from a snapshot provider (a deleted sheet row). The
 * Yayatoh record stays; the inbox flags it until someone dismisses it or the row comes back.
 */
export const REMOTE_DELETED = 'remote_deleted';
/** M6.4b: last-writer conflicts: which side won (the inbox keeps the losing side's values). */
export const CONFLICT_CODES = ['conflict_kept_yayatoh', 'conflict_kept_remote'] as const;
export type ConflictCode = (typeof CONFLICT_CODES)[number];
/** Inbox rows a retry cannot fix (a conflict was decided; a deleted row is the organizer's call). */
export const retryable = (e: { readonly step: string; readonly code: string }) =>
  e.step !== 'conflict' && e.code !== REMOTE_DELETED;

/** One field both sides changed, as the inbox shows it: what was kept and what was lost. */
export interface ConflictField {
  readonly field: string;
  readonly kept: string;
  readonly lost: string;
}

const shown = (v: unknown) => (v === null || v === undefined ? '' : String(v)).slice(0, 1000);

/**
 * The fields where the losing side differs from the winning one (M6.4b), compared as text over
 * the mapped targets: these are the values the inbox shows as lost.
 */
export function conflictFields(
  keys: readonly string[],
  kept: Readonly<Record<string, unknown>>,
  lost: Readonly<Record<string, unknown>>,
): ConflictField[] {
  return keys.flatMap((field) => {
    const k = shown(kept[field]);
    const l = shown(lost[field]);
    return k.trim() === l.trim() ? [] : [{ field, kept: k, lost: l }];
  });
}

/** M6.4b: a Google Sheets link of an event (unlinked ones stay as history). */
export const SHEET_LINK_STATUSES = ['active', 'unlinked'] as const;
export type SheetLinkStatus = (typeof SHEET_LINK_STATUSES)[number];

/** Why a connection was revoked: the organizer disconnected it, or the provider refused it. */
export const REVOKE_REASONS = ['user', 'provider'] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

/** Automatic retries of a failed record before it waits for someone to press Retry. */
export const MAX_RECORD_ATTEMPTS = 5;
const RECORD_BACKOFF_MIN = [1, 5, 15, 60, 240];

/** When a failed record is tried again after `attempts` failures (null: no more automatic tries). */
export function recordRetryAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_RECORD_ATTEMPTS) return null;
  const minutes = RECORD_BACKOFF_MIN[Math.max(0, attempts - 1)] ?? 240;
  return new Date(now.getTime() + minutes * 60_000);
}

/** The next scheduled sync after a run: the interval, or backoff after consecutive failures. */
export function nextSyncAt(now: Date, intervalMinutes: number, consecutiveFailures: number): Date {
  if (consecutiveFailures <= 0) return new Date(now.getTime() + intervalMinutes * 60_000);
  const backoff = Math.min(intervalMinutes, 2 ** Math.min(consecutiveFailures - 1, 10) * 5);
  return new Date(now.getTime() + backoff * 60_000);
}

export const DEFAULT_SYNC_INTERVAL_MINUTES = 60;
export const SYNC_INTERVALS = [15, 60, 360, 1440] as const;

/** A running run's lease: a worker that died mid-run frees the connection after this. */
export const RUN_LEASE_MS = 10 * 60_000;

/** What the record link remembers about the last time a record crossed (either way). */
export interface LinkState {
  /** The remote version we last wrote (push) or applied (pull). */
  readonly remoteVersion: string | null;
  /** The hash of the Yayatoh record as we last wrote it (pull) or sent it (push). */
  readonly localHash: string | null;
  readonly lastSyncedAt: Date | null;
}

export type PullDecision =
  | { readonly action: 'apply' }
  | { readonly action: 'skip'; readonly reason: 'unchanged' | 'own_write' | 'local_newer' };

/**
 * The pull side of the loop guard (origin stamps plus last-writer rules):
 * - the remote version is the one we already applied or wrote ourselves → skip (a replayed page
 *   writes nothing; our own push never echoes back);
 * - a record the provider stamped with our origin → skip;
 * - both sides changed since the last sync and ours is newer → skip (the push sends ours).
 */
export function decidePull(
  remote: { readonly version: string; readonly origin: string | null; readonly updatedAt: Date | null },
  link: LinkState | null,
  ownOrigin: string,
  local: { readonly hash: string; readonly updatedAt: Date } | null,
): PullDecision {
  if (link && link.remoteVersion === remote.version) return { action: 'skip', reason: 'unchanged' };
  if (remote.origin === ownOrigin) return { action: 'skip', reason: 'own_write' };
  if (
    link &&
    local &&
    link.localHash !== null &&
    local.hash !== link.localHash &&
    remote.updatedAt &&
    local.updatedAt > remote.updatedAt
  )
    return { action: 'skip', reason: 'local_newer' };
  return { action: 'apply' };
}

export type PushDecision =
  | { readonly action: 'send' }
  | { readonly action: 'skip'; readonly reason: 'unchanged' };

/**
 * The push side: a Yayatoh record whose hash is the one we last wrote or sent is skipped, so a
 * record the pull just wrote is never sent back.
 */
export function decidePush(localHash: string, link: LinkState | null): PushDecision {
  if (link && link.localHash === localHash) return { action: 'skip', reason: 'unchanged' };
  return { action: 'send' };
}

/** The origin stamp a connection writes on the provider's records (loop guard). */
export const originStamp = (connectionId: string) => `yayatoh:${connectionId}`;
