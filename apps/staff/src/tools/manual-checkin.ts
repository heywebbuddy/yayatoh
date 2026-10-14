/**
 * Manual check-in with a reason (M7.4c): the guest's code will not scan, so staff find them by
 * lookup and admit them by short code. Online it is the same `POST /v1/checkins` as a scan
 * (idempotent per key); offline it goes through the phone's offline scanner (M7.4b), which decides
 * with the saved manifest and queues the scan for sync, exactly as a camera scan would.
 *
 * The reason is required. `/v1/checkins` has no field for it yet, so it is kept in the phone's
 * encrypted audit log (short code, reason and result; no name) and listed in the report as a
 * server gap.
 */
import { YayatohApiError } from '@yayatoh/sdk';
import type { DoorVerdict, ScanResult, StaffApi } from './api';
import type { Vault } from './vault';

export const MANUAL_REASONS = ['wont_scan', 'phone_dead', 'lost_ticket', 'other'] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number];
export const NOTE_MIN = 3;
export const NOTE_MAX = 300;

export type ReasonProblem = 'reason_missing' | 'note_missing' | 'note_too_long';

/** The reason text to record, or why it cannot be used yet. */
export function checkReason(
  reason: ManualReason | null,
  note: string,
): { ok: true; text: string } | { ok: false; problem: ReasonProblem } {
  if (!reason) return { ok: false, problem: 'reason_missing' };
  const n = note.trim();
  if (n.length > NOTE_MAX) return { ok: false, problem: 'note_too_long' };
  if (reason === 'other' && n.length < NOTE_MIN) return { ok: false, problem: 'note_missing' };
  return { ok: true, text: n ? `${reason}: ${n}` : reason };
}

/** What the phone's offline scanner (M7.4b) answers for a code. */
export interface OfflineScanOutcome {
  /** A `checkin-engine` verdict (`admit`, `duplicate`, `invalid`, …). */
  readonly verdict: string;
  readonly holderName: string | null;
  readonly typeName: string | null;
}

export interface OfflineCheckIn {
  scan(code: string): Promise<OfflineScanOutcome>;
}

/** Engine verdicts are named differently from the server's results in two places. */
const FROM_ENGINE: Record<string, ScanResult> = { admit: 'admitted' };

export type ManualResult =
  | {
      readonly via: 'online' | 'offline';
      readonly result: ScanResult;
      readonly holderName: string | null;
      readonly typeName: string | null;
      readonly firstAdmittedAt: string | null;
    }
  | { readonly via: 'none' };

export interface ManualCheckInDeps {
  readonly api: StaffApi | null;
  readonly offline: OfflineCheckIn | null;
  readonly vault: Vault;
  readonly eventId: string;
  readonly checkpointId: string | null;
  readonly now?: () => Date;
  readonly newKey?: () => string;
  /** Whether the phone believes it is offline right now (skips the network attempt). */
  readonly isOffline?: () => boolean;
}

interface LogEntry {
  readonly at: string;
  readonly shortCode: string;
  readonly reason: string;
  readonly result: string;
  readonly via: 'online' | 'offline';
}

const LOG_MAX = 500;

/** Network trouble (not an answer from the server): the phone should decide offline instead. */
function isUnreachable(err: unknown): boolean {
  return !(err instanceof YayatohApiError);
}

export async function manualCheckIn(
  deps: ManualCheckInDeps,
  input: { shortCode: string; reason: string },
): Promise<ManualResult> {
  const now = deps.now ?? (() => new Date());
  const log = async (result: string, via: 'online' | 'offline') => {
    const entries = (await deps.vault.read<LogEntry[]>('manual-log')) ?? [];
    entries.push({
      at: now().toISOString(),
      shortCode: input.shortCode,
      reason: input.reason,
      result,
      via,
    });
    await deps.vault.write('manual-log', entries.slice(-LOG_MAX));
  };

  if (deps.api && !deps.isOffline?.()) {
    try {
      const v: DoorVerdict = await deps.api.checkIn({
        eventId: deps.eventId,
        code: input.shortCode,
        checkpointId: deps.checkpointId,
        idempotencyKey: (deps.newKey ?? defaultKey)(),
      });
      await log(v.result, 'online');
      return { via: 'online', ...v };
    } catch (err) {
      if (!isUnreachable(err)) throw err;
      // No answer from the server: fall through to the saved manifest.
    }
  }
  if (!deps.offline) return { via: 'none' };
  const o = await deps.offline.scan(input.shortCode);
  const result = FROM_ENGINE[o.verdict] ?? (o.verdict as ScanResult);
  await log(result, 'offline');
  return {
    via: 'offline',
    result,
    holderName: o.holderName,
    typeName: o.typeName,
    firstAdmittedAt: null,
  };
}

const defaultKey = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export type VerdictTone = 'ok' | 'warn' | 'stop';

/** Results that let the guest in (including a provisional admit, which the server reconciles). */
const OK: ReadonlySet<ScanResult> = new Set(['admitted', 'provisional', 'granted', 'entered', 'scanned_out']);
const WARN: ReadonlySet<ScanResult> = new Set(['duplicate', 'duplicate_offline', 'balance_due']);

export const verdictTone = (r: ScanResult): VerdictTone => (OK.has(r) ? 'ok' : WARN.has(r) ? 'warn' : 'stop');
