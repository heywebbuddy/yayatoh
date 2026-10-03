import { inRoomKey, type ManifestHeader } from '@yayatoh/checkin-engine';

/** A queued scan as far as the room count is concerned. */
export interface QueuedDoorScan {
  readonly verdict: string;
  readonly checkpointId?: string;
  readonly code?: string;
}

/**
 * M5.6a: the device's estimate of each session room's count: the count when the manifest was
 * made, plus this device's queued (unsynced) entries, minus its queued exits. The server keeps
 * the device's capacity decision on sync, so the estimate only has to be honest for this device.
 */
export function sessionOccupancy(
  header: Pick<ManifestHeader, 'sessions' | 'checkpoints'>,
  queue: readonly QueuedDoorScan[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of header.sessions ?? []) out.set(s.sessionId, (out.get(s.sessionId) ?? 0) + s.occupied);
  const sessionOf = new Map(
    header.checkpoints.flatMap((c) =>
      c.kind === 'session' && c.sessionId ? [[c.id, c.sessionId] as const] : [],
    ),
  );
  for (const q of queue) {
    const sessionId = q.checkpointId ? sessionOf.get(q.checkpointId) : undefined;
    if (!sessionId) continue;
    const delta = q.verdict === 'entered' ? 1 : q.verdict === 'scanned_out' ? -1 : 0;
    out.set(sessionId, Math.max(0, (out.get(sessionId) ?? 0) + delta));
  }
  return out;
}

/** Record a session door verdict in the device's in-room set (returns whether it changed). */
export function applyDoorVerdict(
  inRoom: Set<string>,
  verdict: string,
  ticketId: string | null,
  sessionId: string | null,
): boolean {
  if (!ticketId || !sessionId) return false;
  const key = inRoomKey(ticketId, sessionId);
  if (verdict === 'entered' && !inRoom.has(key)) {
    inRoom.add(key);
    return true;
  }
  if (verdict === 'scanned_out' && inRoom.has(key)) {
    inRoom.delete(key);
    return true;
  }
  return false;
}

/** The gate behind a session door refusal (the override asks to waive it). */
export const GATE_OF_RESULT: Readonly<Record<string, 'enrollment' | 'admission_level' | 'capacity'>> = {
  not_enrolled: 'enrollment',
  admission_level: 'admission_level',
  capacity: 'capacity',
};
