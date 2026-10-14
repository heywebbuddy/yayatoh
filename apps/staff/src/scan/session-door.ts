/**
 * Session doors (M5.6a) as the Scan PWA keeps them (`apps/web/src/scan/session-door.ts`): the
 * device's estimate of each room's count, and who this device let in. The verdicts themselves come
 * from `checkin-engine`; this only feeds it the facts it asks for.
 */
import { inRoomKey, type ManifestHeader } from '@yayatoh/checkin-engine';
import type { DoorLogRow } from './store';

/** The room count when the manifest was made, plus this device's own scans it does not include yet. */
export function sessionOccupancy(
  header: Pick<ManifestHeader, 'sessions' | 'checkpoints'>,
  log: readonly DoorLogRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  // The manifest lists a session once per door, each with the whole room's count: take it once.
  for (const s of header.sessions ?? []) out.set(s.sessionId, s.occupied);
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

/** Records a session door verdict in the in-room set; returns the change (`null` = none). */
export function applyDoorVerdict(
  inRoom: Set<string>,
  verdict: string,
  ticketId: string | null,
  sessionId: string | null,
): { key: string; present: boolean } | null {
  if (!ticketId || !sessionId) return null;
  const key = inRoomKey(ticketId, sessionId);
  if (verdict === 'entered' && !inRoom.has(key)) {
    inRoom.add(key);
    return { key, present: true };
  }
  if (verdict === 'scanned_out' && inRoom.has(key)) {
    inRoom.delete(key);
    return { key, present: false };
  }
  return null;
}
