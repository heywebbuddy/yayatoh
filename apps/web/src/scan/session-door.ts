import { inRoomKey, type ManifestHeader } from '@yayatoh/checkin-engine';

/** A door scan this device made, as far as the room count is concerned. */
export interface DoorLogEntry {
  readonly scanId: string;
  readonly verdict: string;
  readonly checkpointId?: string;
  /** When the server took it (server time, ISO); null while it waits in the queue. */
  readonly syncedAt?: string | null;
}

/**
 * M5.6a: the device's estimate of each session room's count: the count when the manifest was
 * made, plus this device's entries minus its exits that the manifest doesn't include yet (still
 * queued, or synced after it was made). The server keeps the device's capacity decision on sync,
 * so the estimate has to count this device's own scans until the manifest does.
 */
export function sessionOccupancy(
  header: Pick<ManifestHeader, 'sessions' | 'checkpoints'>,
  log: readonly DoorLogEntry[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of header.sessions ?? []) out.set(s.sessionId, (out.get(s.sessionId) ?? 0) + s.occupied);
  const sessionOf = new Map(
    header.checkpoints.flatMap((c) =>
      c.kind === 'session' && c.sessionId ? [[c.id, c.sessionId] as const] : [],
    ),
  );
  for (const q of log) {
    const sessionId = q.checkpointId ? sessionOf.get(q.checkpointId) : undefined;
    if (!sessionId) continue;
    const delta = q.verdict === 'entered' ? 1 : q.verdict === 'scanned_out' ? -1 : 0;
    out.set(sessionId, Math.max(0, (out.get(sessionId) ?? 0) + delta));
  }
  return out;
}

/** After a manifest made at `serverTime`: forget door scans it already counts. */
export function pruneDoorLog(log: readonly DoorLogEntry[], serverTime: string): DoorLogEntry[] {
  const t = new Date(serverTime).getTime();
  return log.filter((e) => !e.syncedAt || new Date(e.syncedAt).getTime() > t);
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
