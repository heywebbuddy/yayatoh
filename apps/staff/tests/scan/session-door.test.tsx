/**
 * Session doors (M5.6a) on the phone: who this device let into a room survives a restart, the room
 * count includes this device's own scans until the manifest does, and the in/out switch drives the
 * scan direction. The verdicts are the engine's; these tests cover the state the app feeds it.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ManifestHeader, ManifestRow } from '@yayatoh/checkin-engine';
import verdicts from '@yayatoh/checkin-engine/vectors/verdicts.json';
import { applyDoorVerdict, sessionOccupancy } from '../../src/scan/session-door';
import { ScanView } from '../../src/scan/ui/scan-screen';
import { camera } from '../mocks/vision-camera';
import { FakeServer, rig } from './harness';
import { renderIn, spyFeedback } from './ui-helpers';

jest.mock('react-native-vision-camera', () => require('../mocks/vision-camera'));

const state = (
  verdicts as unknown as { states: Record<string, { header: ManifestHeader; rows: ManifestRow[] }> }
).states.sessions as { header: ManifestHeader; rows: ManifestRow[] };
const NOW = Date.parse('2027-12-01T20:00:00Z');
const SYNC = Date.parse(state.header.serverTime);
const A = 'SESSAAAA'; // registrant, enrolled in s1, every session

async function doorRig() {
  const server = new FakeServer({ header: state.header, rows: state.rows });
  const r = await rig(server, { at: SYNC });
  await r.engine.sync();
  r.clock.ms = NOW;
  r.engine.setCheckpoint('room-a');
  return { ...r, server };
}

describe('room attendance on the phone', () => {
  it('recognises a session door and names its session', async () => {
    const { engine } = await doorRig();
    expect(engine.sessionDoor).toMatchObject({ checkpointId: 'room-a', sessionId: 's1' });
  });

  it('lets someone in once, remembers it across a restart, and lets them out', async () => {
    const { engine, db, server, clock } = await doorRig();
    expect((await engine.scan(A, { direction: 'in' })).verdict).toBe('entered');
    const again = await rig(server, { db, at: clock.ms });
    again.engine.setCheckpoint('room-a');
    expect((await again.engine.scan(A, { direction: 'in' })).verdict).toBe('duplicate');
    expect((await again.engine.scan(A, { direction: 'out' })).verdict).toBe('scanned_out');
    expect((await again.engine.scan(A, { direction: 'out' })).verdict).toBe('not_in_room');
  });

  it('queues the scan with its direction and the session door', async () => {
    const { engine, store } = await doorRig();
    await engine.scan(A, { direction: 'in' });
    expect(await store.peek(5)).toMatchObject([
      { verdict: 'entered', checkpointId: 'room-a', direction: 'in' },
    ]);
  });

  it('feeds the room count from this device’s own entries until the manifest includes them', async () => {
    const { engine, store } = await doorRig();
    await engine.scan('SESSAAAA');
    const room = sessionOccupancy(
      { checkpoints: engine.checkpoints, sessions: state.header.sessions ?? [] },
      await store.loadDoorLog(),
    ).get('s1');
    expect(room).toBe(1);
  });

  it('counts a room from the manifest plus this device’s unsynced entries and exits', () => {
    const header = {
      checkpoints: [
        { id: 'room-a', name: 'A', kind: 'session' as const, ticketTypeIds: [], sessionId: 's1' },
      ],
      sessions: [
        { checkpointId: 'room-a', sessionId: 's1', title: 'A', startsAt: '', endsAt: '', occupied: 3 },
      ],
    };
    const log = [
      { scanId: '1', verdict: 'entered', checkpointId: 'room-a', syncedAt: null },
      { scanId: '2', verdict: 'entered', checkpointId: 'room-a', syncedAt: null },
      { scanId: '3', verdict: 'scanned_out', checkpointId: 'room-a', syncedAt: null },
      { scanId: '4', verdict: 'duplicate', checkpointId: 'room-a', syncedAt: null },
      { scanId: '5', verdict: 'entered', checkpointId: 'elsewhere', syncedAt: null },
    ];
    expect(sessionOccupancy(header, log).get('s1')).toBe(4);
    expect(
      sessionOccupancy(header, [
        { scanId: '9', verdict: 'scanned_out', checkpointId: 'room-a', syncedAt: null },
      ]).get('s1'),
    ).toBe(2);
    // Never below zero.
    const empty = {
      ...header,
      sessions: [{ ...(header.sessions[0] as (typeof header.sessions)[number]), occupied: 0 }],
    };
    expect(
      sessionOccupancy(empty, [
        { scanId: '9', verdict: 'scanned_out', checkpointId: 'room-a', syncedAt: null },
      ]).get('s1'),
    ).toBe(0);
  });

  it('stops counting this device’s entries once a manifest made after them includes them', async () => {
    const { engine, server, clock, store } = await doorRig();
    await engine.scan(A, { direction: 'in' });
    await engine.flush();
    expect((await store.loadDoorLog())[0]?.syncedAt).toBeTruthy();
    // A manifest made later than the sync drops the entry from the local log.
    server.header = { ...state.header, serverTime: new Date(clock.ms + 60_000).toISOString() };
    clock.ms += 60_000;
    await engine.sync();
    expect(await store.loadDoorLog()).toEqual([]);
  });

  it('applies door verdicts to the in-room set only when they change it', () => {
    const inRoom = new Set<string>();
    expect(applyDoorVerdict(inRoom, 'entered', 't1', 's1')).toMatchObject({ present: true });
    expect(applyDoorVerdict(inRoom, 'entered', 't1', 's1')).toBeNull();
    expect(applyDoorVerdict(inRoom, 'duplicate', 't1', 's1')).toBeNull();
    expect(applyDoorVerdict(inRoom, 'scanned_out', 't1', 's1')).toMatchObject({ present: false });
    expect(applyDoorVerdict(inRoom, 'scanned_out', 't1', 's1')).toBeNull();
    expect(applyDoorVerdict(inRoom, 'entered', null, 's1')).toBeNull();
    expect(applyDoorVerdict(inRoom, 'entered', 't1', null)).toBeNull();
  });
});

describe('the in/out switch', () => {
  beforeEach(() => camera.reset());

  it('shows at a session door and sends scans in the chosen direction', async () => {
    const { engine } = await doorRig();
    let cameraClock = 0;
    renderIn(<ScanView engine={engine} scheduler={null} feedback={spyFeedback()} now={() => cameraClock} />);
    await act(async () => {});
    expect(screen.getByTestId('direction-in')).toBeOnTheScreen();
    await act(async () => camera.see(A));
    await waitFor(() => expect(screen.getByTestId('verdict-title')).toHaveTextContent('Entered'));
    fireEvent.press(screen.getByTestId('direction-out'));
    cameraClock += 10_000;
    expect(screen.getByRole('button', { name: 'Out' })).toHaveProp('accessibilityState', {
      disabled: false,
      selected: true,
    });
    await act(async () => camera.see(`${A} `));
    await waitFor(() => expect(screen.getByTestId('verdict-title')).toHaveTextContent('Scanned out'));
  });
});
