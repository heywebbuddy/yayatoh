/**
 * The spotter's offline queue (M4.8c), pure and storage-agnostic: the spotter page keeps its state
 * in the browser's storage and runs it; the integration tests run the same code against the real
 * command. Each entry carries its own id (`clientId`, made on the device), so a batch that is sent
 * again after a lost response is recorded once: the server answers a known id with the outcome it
 * already gave. An entry leaves the queue only when the server has answered for it.
 */
import { type EntryOutcome, isPaddleNumber, MAX_SYNC_BATCH } from './paddles.ts';

export interface QueuedEntry {
  /** Made on the device (`crypto.randomUUID()`); the server's exactly-once key. */
  readonly clientId: string;
  /** The call the spotter saw armed when they typed the number. */
  readonly callId: string;
  readonly paddle: number;
  /** The device's clock, ISO 8601. */
  readonly recordedAt: string;
}

export interface SettledEntry extends QueuedEntry {
  readonly outcome: EntryOutcome;
}

export interface SpotterQueue {
  /** Waiting for the server, oldest first. */
  readonly pending: readonly QueuedEntry[];
  /** The server's answers, newest first (the last `SETTLED_KEPT`). */
  readonly settled: readonly SettledEntry[];
}

export const SETTLED_KEPT = 50;
export const emptyQueue = (): SpotterQueue => ({ pending: [], settled: [] });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Add an entry (an id already queued or settled is ignored: a double Enter is one entry). */
export function enqueue(q: SpotterQueue, entry: QueuedEntry): SpotterQueue {
  if (q.pending.some((e) => e.clientId === entry.clientId)) return q;
  if (q.settled.some((e) => e.clientId === entry.clientId)) return q;
  return { ...q, pending: [...q.pending, entry] };
}

/** The next batch to send, oldest first. */
export const nextBatch = (q: SpotterQueue, max = MAX_SYNC_BATCH): QueuedEntry[] => q.pending.slice(0, max);

/**
 * Apply the server's answers: answered entries move to `settled`; anything the server did not
 * answer stays queued (sent again next time). Answers for unknown ids are ignored.
 */
export function settle(
  q: SpotterQueue,
  results: readonly { readonly clientId: string; readonly outcome: EntryOutcome }[],
): SpotterQueue {
  const byId = new Map(results.map((r) => [r.clientId, r.outcome]));
  const pending: QueuedEntry[] = [];
  const done: SettledEntry[] = [];
  for (const e of q.pending) {
    const outcome = byId.get(e.clientId);
    if (outcome) done.push({ ...e, outcome });
    else pending.push(e);
  }
  if (done.length === 0) return q;
  return { pending, settled: [...done.reverse(), ...q.settled].slice(0, SETTLED_KEPT) };
}

/** A queue read back from storage, or an empty one when it is missing or malformed. */
export function restoreQueue(raw: string | null | undefined): SpotterQueue {
  if (!raw) return emptyQueue();
  try {
    const v = JSON.parse(raw) as { pending?: unknown; settled?: unknown };
    const ok = (e: unknown): e is QueuedEntry => {
      const x = e as Partial<QueuedEntry> | null;
      return (
        !!x &&
        typeof x.clientId === 'string' &&
        UUID.test(x.clientId) &&
        typeof x.callId === 'string' &&
        UUID.test(x.callId) &&
        isPaddleNumber(x.paddle) &&
        typeof x.recordedAt === 'string' &&
        !Number.isNaN(Date.parse(x.recordedAt))
      );
    };
    const pending = Array.isArray(v.pending) ? v.pending.filter(ok) : [];
    const settled = Array.isArray(v.settled)
      ? v.settled.filter(
          (e): e is SettledEntry =>
            ok(e) && typeof (e as SettledEntry).outcome?.status === 'string',
        )
      : [];
    return { pending, settled: settled.slice(0, SETTLED_KEPT) };
  } catch {
    return emptyQueue();
  }
}
