import { generateKeyPair, signStatement, signTicketCode } from '@yayatoh/ticket-crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  dwellMs,
  GATE_RESULT,
  gateOf,
  inRoomKey,
  MANIFEST_VERSION,
  type ManifestHeader,
  type ManifestRow,
  type ManifestScope,
  type OfflineState,
  offlineVerdict,
  SCOPE_TAG,
  type SignedSessionGate,
  scopeMessage,
  sessionGateResult,
  verifyManifestScope,
} from '../src/index.ts';

const NOW = new Date('2027-12-01T20:00:00Z');
const A = '0192f000-0000-7000-8000-00000000000a';
const B = '0192f000-0000-7000-8000-00000000000b';
const C = '0192f000-0000-7000-8000-00000000000c';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

beforeAll(async () => {
  keys = await generateKeyPair();
});

describe('session gates (M5.6a)', () => {
  const rule = { sessionId: 's1', capacity: 2, enrollmentRequired: true };
  const ok = { registrant: true, sessionIds: null, enrolled: true };

  it('passes when registered, enrolled, given the session and the room has space', () => {
    expect(sessionGateResult({ rule, access: ok, occupied: 1 })).toBe('ok');
  });

  it('refuses in order: enrollment, admission level, capacity', () => {
    expect(sessionGateResult({ rule, access: { ...ok, enrolled: false }, occupied: 0 })).toBe('not_enrolled');
    expect(sessionGateResult({ rule, access: { ...ok, registrant: false }, occupied: 9 })).toBe('not_enrolled');
    expect(sessionGateResult({ rule, access: { ...ok, sessionIds: ['s2'] }, occupied: 9 })).toBe(
      'admission_level',
    );
    expect(sessionGateResult({ rule, access: ok, occupied: 2 })).toBe('capacity');
  });

  it('no enrollment needed: any registrant passes the first gate; non-registrants never do', () => {
    const open = { ...rule, enrollmentRequired: false };
    expect(sessionGateResult({ rule: open, access: { ...ok, enrolled: false }, occupied: 0 })).toBe('ok');
    expect(sessionGateResult({ rule: open, access: { ...ok, registrant: false }, occupied: 0 })).toBe(
      'not_enrolled',
    );
    // A pass unknown to the device passes only where no enrollment is needed.
    expect(sessionGateResult({ rule: open, access: null, occupied: 0 })).toBe('ok');
    expect(sessionGateResult({ rule, access: null, occupied: 0 })).toBe('not_enrolled');
  });

  it('no capacity: never full', () => {
    expect(sessionGateResult({ rule: { ...rule, capacity: null }, access: ok, occupied: 10_000 })).toBe('ok');
  });

  it('an override waives only the named gates', () => {
    const full = { rule, access: { ...ok, enrolled: false }, occupied: 2 };
    expect(sessionGateResult({ ...full, overrides: ['enrollment'] })).toBe('capacity');
    expect(sessionGateResult({ ...full, overrides: ['enrollment', 'capacity'] })).toBe('ok');
    expect(sessionGateResult({ ...full, overrides: ['capacity'] })).toBe('not_enrolled');
  });

  it('maps results to gates and back', () => {
    expect(gateOf('capacity')).toBe('capacity');
    expect(gateOf('not_enrolled')).toBe('enrollment');
    expect(gateOf('admission_level')).toBe('admission_level');
    expect(gateOf('admitted')).toBeNull();
    expect(GATE_RESULT.enrollment).toBe('not_enrolled');
  });

  it('dwell time sums visits; an open visit counts until now; reversed times count nothing', () => {
    const at = (m: number) => new Date(NOW.getTime() + m * 60_000);
    expect(
      dwellMs(
        [
          { inAt: at(0), outAt: at(30) },
          { inAt: at(40), outAt: null },
          { inAt: at(50), outAt: at(45) },
        ],
        at(60),
      ),
    ).toBe(50 * 60_000);
  });
});

describe('offline session doors (manifest v3)', () => {
  const gate: SignedSessionGate = {
    checkpointId: 'room-a',
    sessionId: 's1',
    capacity: 2,
    enrollmentRequired: true,
    enrolled: [A, B],
  };

  async function scope(gates: SignedSessionGate[] = [gate]): Promise<ManifestScope> {
    const base = { eventId: 'e1', deviceId: 'd1', checkpointIds: null, sessionGates: gates };
    return { ...base, signature: await signStatement(SCOPE_TAG, scopeMessage(base), 1, keys.privateKey) };
  }

  function header(s: ManifestScope): ManifestHeader {
    return {
      event: {
        id: 'e1',
        name: 'Conf',
        startsAt: '2027-12-01T15:00:00Z',
        endsAt: '2027-12-03T04:00:00Z',
        timezone: 'America/Chicago',
      },
      publicKeys: { '1': b64(keys.publicKey) },
      salt: 's',
      serverTime: NOW.toISOString(),
      unknownPolicy: 'provisional',
      checkpoints: [
        { id: 'room-a', name: 'Room A', kind: 'session', ticketTypeIds: [], sessionId: 's1' },
        { id: 'north', name: 'North', kind: 'entrance', ticketTypeIds: [] },
      ],
      version: MANIFEST_VERSION,
      scope: s,
    };
  }

  const row = (ticketId: string, code: string, sessionIds: string[] | null = null): ManifestRow => ({
    ticketId,
    shortCode: code,
    rev: 0,
    status: 'active',
    ticketTypeId: 'pass',
    typeName: 'Pass',
    accessDates: [],
    holderName: code,
    emailHash: '',
    issuedAt: NOW.toISOString(),
    sessionAccess: { registrant: true, sessionIds },
  });

  async function state(extra: Partial<OfflineState> = {}): Promise<OfflineState> {
    const rows = [row(A, 'AAAAAAAA'), row(B, 'BBBBBBBB', ['s2']), row(C, 'CCCCCCCC')];
    return {
      header: header(await scope()),
      byId: new Map(rows.map((r) => [r.ticketId, r])),
      byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
      admitted: new Set(),
      lastSyncAt: NOW,
      ...extra,
    };
  }

  it('enters an enrolled registrant; refuses the unenrolled and the wrong admission level', async () => {
    const s = await state();
    expect((await offlineVerdict(s, 'AAAAAAAA', NOW, 'room-a')).verdict).toBe('entered');
    expect((await offlineVerdict(s, 'CCCCCCCC', NOW, 'room-a')).verdict).toBe('not_enrolled');
    expect((await offlineVerdict(s, 'BBBBBBBB', NOW, 'room-a')).verdict).toBe('admission_level');
  });

  it('a full room refuses with capacity; someone already in is a duplicate', async () => {
    const full = await state({ occupancy: new Map([['s1', 2]]) });
    expect((await offlineVerdict(full, 'AAAAAAAA', NOW, 'room-a')).verdict).toBe('capacity');
    const inside = await state({ inRoom: new Set([inRoomKey(A, 's1')]) });
    expect((await offlineVerdict(inside, 'AAAAAAAA', NOW, 'room-a')).verdict).toBe('duplicate');
  });

  it('scan out: scanned_out for someone in the room, not_in_room otherwise', async () => {
    const inside = await state({ inRoom: new Set([inRoomKey(A, 's1')]) });
    expect((await offlineVerdict(inside, 'AAAAAAAA', NOW, 'room-a', { direction: 'out' })).verdict).toBe(
      'scanned_out',
    );
    expect((await offlineVerdict(inside, 'CCCCCCCC', NOW, 'room-a', { direction: 'out' })).verdict).toBe(
      'not_in_room',
    );
  });

  it('the event rules still come first (an unknown code is invalid; a used entrance admission is no duplicate here)', async () => {
    const s = await state({ admitted: new Set([`${A}:2027-12-01`]) });
    expect((await offlineVerdict(s, 'ZZZZZZZZ', NOW, 'room-a')).verdict).toBe('invalid');
    expect((await offlineVerdict(s, 'AAAAAAAA', NOW, 'room-a')).verdict).toBe('entered');
    expect((await offlineVerdict(s, 'AAAAAAAA', NOW, 'north')).verdict).toBe('duplicate');
  });

  it('an unknown signed pass enters only where no enrollment is needed', async () => {
    const fresh = '0193f000-0000-7000-8000-0000000000ff';
    const code = await signTicketCode({ kid: 1, ticketId: fresh, rev: 0 }, keys.privateKey);
    const s = await state({ lastSyncAt: new Date('2020-01-01T00:00:00Z') });
    expect((await offlineVerdict(s, code, NOW, 'room-a')).verdict).toBe('not_enrolled');
    const open = { ...gate, enrollmentRequired: false, enrolled: [] };
    const s2: OfflineState = { ...s, header: header(await scope([open])) };
    expect((await offlineVerdict(s2, code, NOW, 'room-a')).verdict).toBe('entered');
  });

  it('the gates are signed: a widened capacity or enrolled list fails verification', async () => {
    const s = await scope();
    expect(await verifyManifestScope(header(s))).toBe(true);
    const widened = { ...s, sessionGates: [{ ...gate, capacity: 500 }] };
    expect(await verifyManifestScope(header(widened))).toBe(false);
    const enrolled = { ...s, sessionGates: [{ ...gate, enrolled: [A, B, C] }] };
    expect(await verifyManifestScope(header(enrolled))).toBe(false);
    // A session door without signed gates is refused as a whole, and admits nobody.
    const { sessionGates: _drop, ...bare } = s;
    expect(await verifyManifestScope(header(bare as ManifestScope))).toBe(false);
    const st = { ...(await state()), header: header(bare as ManifestScope) };
    expect((await offlineVerdict(st, 'AAAAAAAA', NOW, 'room-a')).verdict).toBe('invalid');
  });

  it('gate order and enrolled order do not change the signed message', () => {
    const base = { eventId: 'e1', deviceId: 'd1', checkpointIds: null };
    const g2 = { ...gate, checkpointId: 'room-b' };
    expect(
      scopeMessage({ ...base, sessionGates: [gate, { ...g2, enrolled: [B, A] }] }) ===
        scopeMessage({ ...base, sessionGates: [g2, gate] }),
    ).toBe(true);
  });
});
