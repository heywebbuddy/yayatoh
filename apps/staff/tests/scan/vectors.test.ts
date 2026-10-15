/**
 * Acceptance: every M7.1a test vector (ADR 0011) gives the same verdict through the app's own path
 * as in Node. Each scenario runs the whole way a door does: the manifest is downloaded through the
 * engine's sync (which verifies the signed scope), saved in SQLite, read back, and the code scanned.
 */

import type { ManifestHeader, ManifestRow } from '@yayatoh/checkin-engine';
import verdicts from '@yayatoh/checkin-engine/vectors/verdicts.json';
import { FakeServer, rig } from './harness';

interface StateDef {
  header: ManifestHeader;
  rows: ManifestRow[];
  lastSyncAt: string;
}
interface Scenario {
  name: string;
  rule: string;
  state: string;
  code: string;
  now: string;
  checkpointId: string | null;
  direction: 'in' | 'out';
  admitted: string[];
  inRoom: string[];
  occupancy: Record<string, number>;
  expect: { verdict: string; ticketId: string | null };
}
const file = verdicts as unknown as { states: Record<string, StateDef>; scenarios: Scenario[] };

/** The vectors give a room's count directly; the manifest carries it in `header.sessions`. */
function withOccupancy(header: ManifestHeader, occupancy: Record<string, number>): ManifestHeader {
  const sessions = header.checkpoints.flatMap((c) =>
    c.kind === 'session' && c.sessionId
      ? [
          {
            checkpointId: c.id,
            sessionId: c.sessionId,
            title: c.name,
            startsAt: header.event.startsAt,
            endsAt: header.event.endsAt,
            occupied: occupancy[c.sessionId] ?? 0,
          },
        ]
      : [],
  );
  return sessions.length ? { ...header, sessions } : header;
}

describe('M7.1a verdict vectors, through the app', () => {
  it('covers the whole corpus', () => {
    expect(file.scenarios.length).toBeGreaterThanOrEqual(60);
  });

  for (const s of file.scenarios) {
    it(`${s.rule}: ${s.name}`, async () => {
      const def = file.states[s.state] as StateDef;
      const server = new FakeServer({
        header: withOccupancy(def.header, s.occupancy),
        rows: def.rows,
      });
      // Download at the manifest's own server time (so the clock offset is zero), then scan at `now`.
      const r = await rig(server, { at: Date.parse(def.header.serverTime) });
      for (const key of s.admitted) await r.store.addAdmission(key, { at: s.now, checkpointId: null });
      for (const key of s.inRoom) await r.store.setInRoom(key, true);
      await r.engine.sync();
      // Reload from SQLite: the verdict must come from what the phone saved, not from memory.
      const reloaded = await rig(server, { db: r.db, at: Date.parse(s.now) });
      expect(reloaded.engine.status.phase).toBe('ready');
      reloaded.engine.setCheckpoint(s.checkpointId);
      const out = await reloaded.engine.scan(s.code, { direction: s.direction });
      expect({ verdict: out.verdict, ticketId: out.ticketId }).toEqual(s.expect);
    });
  }
});
