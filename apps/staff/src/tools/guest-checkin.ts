/**
 * Guest-list check-in (M7.4c): the event's guests by name or party, offline too. The last answer
 * of `GET /v1/staff/events/{eventId}/guests` is kept encrypted on the phone, and every check-in goes
 * into an outbox first (a `clientId` per check-in, so a resend is a no-op on the server) and is
 * sent to `POST /v1/staff/guest-arrivals` in batches of up to 500. The first arrival of a guest
 * wins, with the device clock corrected by its measured offset, so two doors cannot both "win".
 */
import { YayatohApiError } from '@yayatoh/sdk';
import type { GuestArrival, GuestArrivalResult, GuestSnapshot, StaffApi } from './api';
import type { Vault } from './vault';

export const MAX_ARRIVALS_PER_SYNC = 500;
const SNAPSHOT_FILE = 'guests';
const OUTBOX_FILE = 'guest-outbox';

export interface SavedSnapshot {
  readonly eventId: string;
  readonly savedAt: string;
  readonly snapshot: GuestSnapshot;
}

export interface LoadedGuests {
  readonly snapshot: GuestSnapshot;
  /** `live`: just downloaded; `saved`: the phone is offline, so this is the last copy it kept. */
  readonly source: 'live' | 'saved';
  readonly savedAt: string;
}

export async function loadGuests(
  api: StaffApi | null,
  vault: Vault,
  eventId: string,
  now: () => Date = () => new Date(),
): Promise<LoadedGuests | null> {
  if (api) {
    try {
      const snapshot = await api.guests(eventId);
      const savedAt = now().toISOString();
      await vault.write(SNAPSHOT_FILE, { eventId, savedAt, snapshot } satisfies SavedSnapshot);
      return { snapshot, source: 'live', savedAt };
    } catch (err) {
      // An answer from the server (401, 403) is not "offline"; only a missing answer falls back.
      if (isAnswer(err)) throw err;
    }
  }
  const saved = await vault.read<SavedSnapshot>(SNAPSHOT_FILE);
  if (!saved || saved.eventId !== eventId) return null;
  return { snapshot: saved.snapshot, source: 'saved', savedAt: saved.savedAt };
}

const isAnswer = (err: unknown): boolean => err instanceof YayatohApiError;

export interface OutboxItem extends GuestArrival {
  readonly eventId: string;
}

export interface FlushOutcome {
  readonly sent: number;
  /** Check-ins the server says someone made earlier, by guest id. */
  readonly already: readonly string[];
  readonly unknown: readonly string[];
  /** Left in the outbox for a later try (no answer, or a server error). */
  readonly pending: number;
  readonly failed: boolean;
}

export interface GuestOutbox {
  load(): Promise<readonly OutboxItem[]>;
  /** Queue a check-in. Checking in the same guest again before it syncs returns the first one. */
  add(guestId: string): Promise<OutboxItem>;
  flush(): Promise<FlushOutcome>;
}

export function createGuestOutbox(deps: {
  readonly vault: Vault;
  readonly api: StaffApi | null;
  readonly eventId: string;
  readonly now?: () => Date;
  readonly clockOffsetMs?: () => number;
  readonly newId: () => string;
  readonly source?: 'scanner' | 'kiosk';
}): GuestOutbox {
  const now = deps.now ?? (() => new Date());
  const read = async () => (await deps.vault.read<OutboxItem[]>(OUTBOX_FILE)) ?? [];
  // One flush at a time: a second tap while one is running joins it.
  let running: Promise<FlushOutcome> | null = null;

  async function run(): Promise<FlushOutcome> {
    let items = (await read()).filter((i) => i.eventId === deps.eventId);
    const already: string[] = [];
    const unknown: string[] = [];
    let sent = 0;
    let failed = false;
    if (!deps.api) return { sent, already, unknown, pending: items.length, failed: items.length > 0 };
    while (items.length > 0) {
      const batch = items.slice(0, MAX_ARRIVALS_PER_SYNC);
      let results: readonly { clientId: string; result: GuestArrivalResult }[];
      try {
        results = (
          await deps.api.recordArrivals(
            deps.eventId,
            batch.map(({ eventId: _e, ...a }) => a),
          )
        ).results;
      } catch {
        failed = true;
        break;
      }
      const answered = new Set(results.map((r) => r.clientId));
      const guestOf = new Map(batch.map((i) => [i.clientId, i.guestId]));
      for (const r of results) {
        const g = guestOf.get(r.clientId);
        if (!g) continue;
        if (r.result === 'already') already.push(g);
        else if (r.result === 'unknown') unknown.push(g);
      }
      sent += answered.size;
      // Keep anything the server did not answer; drop what it did.
      const all = await read();
      await deps.vault.write(
        OUTBOX_FILE,
        all.filter((i) => !answered.has(i.clientId)),
      );
      items = items.filter((i) => !answered.has(i.clientId));
      if (answered.size === 0) {
        failed = true;
        break;
      }
    }
    return { sent, already, unknown, pending: items.length, failed };
  }

  return {
    load: read,
    async add(guestId) {
      const all = await read();
      const dup = all.find((i) => i.guestId === guestId && i.eventId === deps.eventId);
      if (dup) return dup;
      const item: OutboxItem = {
        eventId: deps.eventId,
        clientId: deps.newId(),
        guestId,
        deviceTs: now().toISOString(),
        clockOffsetMs: Math.round(deps.clockOffsetMs?.() ?? 0),
        source: deps.source ?? 'scanner',
      };
      await deps.vault.write(OUTBOX_FILE, [...all, item]);
      return item;
    },
    flush() {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
