import { inRoomKey, type ManifestHeader } from '@yayatoh/checkin-engine';
import { describe, expect, it } from 'vitest';
import { applyDoorVerdict, GATE_OF_RESULT, sessionOccupancy } from '../src/scan/session-door.ts';

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
      { verdict: 'entered', checkpointId: 'door-a' },
      { verdict: 'entered', checkpointId: 'door-b' },
      { verdict: 'scanned_out', checkpointId: 'door-a' },
      { verdict: 'capacity', checkpointId: 'door-a' },
      { verdict: 'admit', checkpointId: 'gate' },
    ]);
    expect(occ.get('s1')).toBe(4);
    expect(sessionOccupancy(header, [{ verdict: 'scanned_out', checkpointId: 'door-a' }]).get('s1')).toBe(2);
    expect(sessionOccupancy({ checkpoints: [], sessions: [] }, []).size).toBe(0);
  });

  it('never goes below zero', () => {
    const empty = { ...header, sessions: [] };
    expect(sessionOccupancy(empty, [{ verdict: 'scanned_out', checkpointId: 'door-a' }]).get('s1')).toBe(0);
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
