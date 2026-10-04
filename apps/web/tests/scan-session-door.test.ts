import { inRoomKey, type ManifestHeader } from '@yayatoh/checkin-engine';
import { describe, expect, it } from 'vitest';
import {
  applyDoorVerdict,
  GATE_OF_RESULT,
  pruneDoorLog,
  sessionOccupancy,
} from '../src/scan/session-door.ts';

const header: Pick<ManifestHeader, 'sessions' | 'checkpoints'> = {
  checkpoints: [
    { id: 'door-a', name: 'A', kind: 'session', ticketTypeIds: [], sessionId: 's1' },
    { id: 'door-b', name: 'B', kind: 'session', ticketTypeIds: [], sessionId: 's1' },
    { id: 'gate', name: 'Gate', kind: 'entrance', ticketTypeIds: [] },
  ],
  sessions: [{ checkpointId: 'door-a', sessionId: 's1', title: 'T', startsAt: '', endsAt: '', occupied: 3 }],
};

describe('Scan PWA session doors (M5.6a)', () => {
  it('the room count is the manifest’s plus this device’s queued entries minus its exits', () => {
    const occ = sessionOccupancy(header, [
      { scanId: '1', verdict: 'entered', checkpointId: 'door-a' },
      { scanId: '2', verdict: 'entered', checkpointId: 'door-b' },
      { scanId: '3', verdict: 'scanned_out', checkpointId: 'door-a' },
      { scanId: '4', verdict: 'capacity', checkpointId: 'door-a' },
      { scanId: '5', verdict: 'admit', checkpointId: 'gate' },
    ]);
    expect(occ.get('s1')).toBe(4);
    expect(
      sessionOccupancy(header, [{ scanId: '1', verdict: 'scanned_out', checkpointId: 'door-a' }]).get('s1'),
    ).toBe(2);
    expect(sessionOccupancy({ checkpoints: [], sessions: [] }, []).size).toBe(0);
  });

  it('a manifest made after a scan synced already counts it; queued and later-synced scans stay', () => {
    const log = [
      { scanId: 'a', verdict: 'entered', checkpointId: 'door-a', syncedAt: '2027-01-01T10:00:00Z' },
      { scanId: 'b', verdict: 'entered', checkpointId: 'door-a', syncedAt: '2027-01-01T10:05:00Z' },
      { scanId: 'c', verdict: 'entered', checkpointId: 'door-a', syncedAt: null },
    ];
    expect(pruneDoorLog(log, '2027-01-01T10:01:00Z').map((e) => e.scanId)).toEqual(['b', 'c']);
    expect(pruneDoorLog(log, '2027-01-01T10:10:00Z').map((e) => e.scanId)).toEqual(['c']);
  });

  it('never goes below zero', () => {
    const empty = { ...header, sessions: [] };
    expect(
      sessionOccupancy(empty, [{ scanId: '1', verdict: 'scanned_out', checkpointId: 'door-a' }]).get('s1'),
    ).toBe(0);
  });

  it('in and out move the in-room set; refusals do not', () => {
    const inRoom = new Set<string>();
    expect(applyDoorVerdict(inRoom, 'entered', 't1', 's1')).toBe(true);
    expect(inRoom.has(inRoomKey('t1', 's1'))).toBe(true);
    expect(applyDoorVerdict(inRoom, 'entered', 't1', 's1')).toBe(false);
    expect(applyDoorVerdict(inRoom, 'capacity', 't2', 's1')).toBe(false);
    expect(applyDoorVerdict(inRoom, 'scanned_out', 't1', 's1')).toBe(true);
    expect(inRoom.size).toBe(0);
    expect(applyDoorVerdict(inRoom, 'entered', null, 's1')).toBe(false);
  });

  it('names the gate behind each refusal', () => {
    expect(GATE_OF_RESULT.capacity).toBe('capacity');
    expect(GATE_OF_RESULT.not_enrolled).toBe('enrollment');
    expect(GATE_OF_RESULT.admitted).toBeUndefined();
  });
});
