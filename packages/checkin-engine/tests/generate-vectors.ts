import { createHash } from 'node:crypto';
import { ed25519KeyPairFromSeed, signStatement, signTicketCode } from '@yayatoh/ticket-crypto';
import {
  MANIFEST_VERSION,
  type ManifestHeader,
  type ManifestRow,
  type ManifestScope,
  SCOPE_TAG,
  type SignedSessionGate,
  scopeMessage,
} from '../src/index.ts';

/**
 * The fixed test vectors of the door's decisions (M7.1a): every ADR 0011 verdict row, the event
 * rules, checkpoints and session doors, the offline lookup hashes, first-wins with clock offsets,
 * and signed manifest scopes. Every EXPECTATION below is a literal written by hand from ADR 0011
 * and the rules (never the engine's own output), and every hash comes from Node's OpenSSL. The
 * Scan PWA, Node and the Staff app must all give these verdicts.
 *
 * `pnpm --filter @yayatoh/checkin-engine vectors:write` rewrites `vectors/*.json`;
 * `vectors.test.ts` fails when the committed files differ from what this script produces.
 */

// ── fixed keys, ids and times ───────────────────────────────────────────────────────────────────
const sha256 = (data: string) => createHash('sha256').update(data).digest();
const SEED_RULE = "seed = SHA-256('yayatoh-test-vector-key:' + label)";
function key(label: string) {
  const seed = new Uint8Array(sha256(`yayatoh-test-vector-key:${label}`));
  const pair = ed25519KeyPairFromSeed(seed);
  return { ...pair, b64: Buffer.from(pair.publicKey).toString('base64') };
}
const ORG = key('org-a');
const OTHER = key('attacker');

const idAt = (ms: number, tail: string) =>
  `${ms
    .toString(16)
    .padStart(12, '0')
    .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-${tail}`;
const SYNC = Date.parse('2027-12-01T12:00:00Z');
const DAY = 86_400_000;
const NOW = '2027-12-01T20:00:00Z'; // 2 pm in Chicago, Dec 1

const KNOWN = idAt(SYNC - DAY, '000000000001'); // rev 1
const GALA = idAt(SYNC - DAY, '000000000002'); // VIP type, valid Dec 2 only
const VOIDED = idAt(SYNC - DAY, '000000000003');
const LATE = idAt(SYNC + 60_000, '000000000004'); // issued after the last sync, not in the manifest
const OLD_UNKNOWN = idAt(SYNC - 3_600_000, '000000000005'); // issued before it, not in the manifest
const MIGRATED = idAt(SYNC - DAY, '000000000006');
const AT_SYNC = idAt(SYNC, '000000000007'); // issued at the last sync instant exactly
const AFTER_SYNC = idAt(SYNC + 1, '000000000008'); // one millisecond later

const SALT = 'yy-manifest:e1';
const hash = (s: string) => sha256(s).toString('hex');
const emailHash = (email: string) => hash(`${SALT}:${email.trim().toLowerCase()}`);
const phoneHash = (digits8: string) => hash(`${SALT}:tel:${digits8}`);
const legacyHash = (payload: string) => hash(`legacy:${SALT}:${payload}`);

const row = (ticketId: string, shortCode: string, over: Partial<ManifestRow> = {}): ManifestRow => ({
  ticketId,
  shortCode,
  rev: 0,
  status: 'active',
  ticketTypeId: 'type-ga',
  typeName: 'General',
  accessDates: [],
  holderName: 'Sam Smith',
  emailHash: emailHash('sam@example.test'),
  issuedAt: new Date(Number.parseInt(ticketId.replace(/-/g, '').slice(0, 12), 16)).toISOString(),
  ...over,
});

const EVENT = {
  id: 'e1',
  name: 'Vector Summit',
  startsAt: '2027-12-01T15:00:00Z',
  endsAt: '2027-12-03T04:00:00Z',
  timezone: 'America/Chicago',
} as const;

const CHECKPOINTS: ManifestHeader['checkpoints'] = [
  { id: 'north', name: 'North gate', kind: 'entrance', ticketTypeIds: [] },
  { id: 'vip', name: 'VIP lounge', kind: 'zone', ticketTypeIds: ['type-vip'] },
  { id: 'hall', name: 'Hall', kind: 'zone', ticketTypeIds: [] },
];

async function scope(
  checkpointIds: string[] | null,
  sessionGates?: SignedSessionGate[],
): Promise<ManifestScope> {
  const base = { eventId: 'e1', deviceId: 'd1', checkpointIds, ...(sessionGates ? { sessionGates } : {}) };
  return { ...base, signature: await signStatement(SCOPE_TAG, scopeMessage(base), 1, ORG.privateKey) };
}

interface StateDef {
  readonly header: ManifestHeader;
  readonly rows: readonly ManifestRow[];
  readonly lastSyncAt: string;
}

const header = (over: Partial<ManifestHeader>): ManifestHeader => ({
  event: EVENT,
  publicKeys: { '1': ORG.b64 },
  salt: SALT,
  serverTime: new Date(SYNC).toISOString(),
  unknownPolicy: 'provisional',
  checkpoints: CHECKPOINTS,
  version: MANIFEST_VERSION,
  ...over,
});

// ── the manifests the scenarios run against ──────────────────────────────────────────────────────
const MAIN_ROWS: ManifestRow[] = [
  row(KNOWN, 'KNOWNAAA', { rev: 1, holderName: 'Ada Lovelace', phoneHash: phoneHash('55550134') }),
  row(GALA, 'GALAAAAA', {
    ticketTypeId: 'type-vip',
    typeName: 'VIP',
    accessDates: [{ date: '2027-12-02', name: 'Gala' }],
    holderName: 'Grace Hopper',
  }),
  row(VOIDED, 'VOIDAAAA', { status: 'void', holderName: 'Alan Turing' }),
  row(MIGRATED, 'MIGRATED', {
    holderName: 'Migrated Holder',
    legacyCodes: [legacyHash('AbC-123-xyz'), legacyHash('172633440000017')],
  }),
];

async function states(): Promise<Record<string, StateDef>> {
  const lastSyncAt = new Date(SYNC).toISOString();
  const SA = idAt(SYNC - DAY, '0000000000a1'); // registrant, every session
  const SB = idAt(SYNC - DAY, '0000000000a2'); // registrant, session s2 only
  const SC = idAt(SYNC - DAY, '0000000000a3'); // registrant, every session, never enrolled
  const SD = idAt(SYNC - DAY, '0000000000a4'); // not a registrant
  const SE = idAt(SYNC - DAY, '0000000000a5'); // void
  const gates: SignedSessionGate[] = [
    { checkpointId: 'room-a', sessionId: 's1', capacity: 2, enrollmentRequired: true, enrolled: [SB, SA] },
    { checkpointId: 'room-b', sessionId: 's2', capacity: null, enrollmentRequired: false, enrolled: [] },
    { checkpointId: 'room-c', sessionId: 's3', capacity: 1, enrollmentRequired: false, enrolled: [] },
  ];
  const sessionRow = (id: string, short: string, access: ManifestRow['sessionAccess'], over = {}) =>
    row(id, short, { sessionAccess: access, ...over });
  const O1 = {
    id: 'o1',
    startsAt: '2027-12-01T15:00:00Z',
    endsAt: '2027-12-01T23:00:00Z',
    status: 'scheduled',
  } as const;
  const O2 = {
    id: 'o2',
    startsAt: '2027-12-02T15:00:00Z',
    endsAt: '2027-12-02T23:00:00Z',
    status: 'scheduled',
  } as const;
  const O3 = {
    id: 'o3',
    startsAt: '2027-12-01T15:00:00Z',
    endsAt: '2027-12-01T23:00:00Z',
    status: 'cancelled',
  } as const;
  return {
    main: { header: header({ scope: await scope(null) }), rows: MAIN_ROWS, lastSyncAt },
    'policy-reject': {
      header: header({ unknownPolicy: 'reject', scope: await scope(null) }),
      rows: MAIN_ROWS,
      lastSyncAt,
    },
    'scoped-north': { header: header({ scope: await scope(['north']) }), rows: MAIN_ROWS, lastSyncAt },
    'manifest-v1': {
      header: (({ version: _v, scope: _s, ...rest }) => rest)(header({})) as ManifestHeader,
      rows: MAIN_ROWS,
      lastSyncAt,
    },
    'no-legacy': {
      header: header({ scope: await scope(null) }),
      rows: MAIN_ROWS.map(({ legacyCodes: _l, ...r }) => r),
      lastSyncAt,
    },
    'multi-date': {
      header: header({ scope: await scope(null), occurrences: [O1, O2, O3] }),
      rows: [
        row(idAt(SYNC - DAY, '0000000000b1'), 'OCCONEAA', { occurrenceId: 'o1' }),
        row(idAt(SYNC - DAY, '0000000000b2'), 'OCCTWOAA', { occurrenceId: 'o2' }),
        row(idAt(SYNC - DAY, '0000000000b3'), 'OCCCANCL', { occurrenceId: 'o3' }),
        row(idAt(SYNC - DAY, '0000000000b4'), 'OCCGHOST', { occurrenceId: 'o9' }),
      ],
      lastSyncAt,
    },
    sessions: {
      header: header({
        scope: await scope(null, gates),
        checkpoints: [
          { id: 'north', name: 'North gate', kind: 'entrance', ticketTypeIds: [] },
          { id: 'room-a', name: 'Room A', kind: 'session', ticketTypeIds: [], sessionId: 's1' },
          { id: 'room-b', name: 'Room B', kind: 'session', ticketTypeIds: [], sessionId: 's2' },
          { id: 'room-c', name: 'Room C', kind: 'session', ticketTypeIds: [], sessionId: 's3' },
          // No signed gate for this one: a session door that can't prove its rules admits nobody.
          { id: 'room-x', name: 'Room X', kind: 'session', ticketTypeIds: [], sessionId: 'sx' },
        ],
        sessions: [
          {
            checkpointId: 'room-a',
            sessionId: 's1',
            title: 'Keynote',
            startsAt: '2027-12-01T16:00:00Z',
            endsAt: '2027-12-01T17:00:00Z',
            occupied: 0,
          },
        ],
      }),
      rows: [
        sessionRow(SA, 'SESSAAAA', { registrant: true, sessionIds: null }),
        sessionRow(SB, 'SESSBBBB', { registrant: true, sessionIds: ['s2'] }),
        sessionRow(SC, 'SESSCCCC', { registrant: true, sessionIds: null }),
        sessionRow(SD, 'SESSDDDD', { registrant: false, sessionIds: null }),
        sessionRow(SE, 'SESSEEEE', { registrant: true, sessionIds: null }, { status: 'void' }),
      ],
      lastSyncAt,
    },
  };
}

// ── scenarios ───────────────────────────────────────────────────────────────────────────────────
interface Scenario {
  readonly name: string;
  /** Which ADR 0011 row or rule this pins down. */
  readonly rule: string;
  readonly state: string;
  readonly code: string;
  readonly now?: string;
  readonly checkpointId?: string | null;
  readonly direction?: 'in' | 'out';
  /** `ticketId:day` keys this device has already admitted. */
  readonly admitted?: readonly string[];
  /** `ticketId@sessionId` keys of people this device let into a session. */
  readonly inRoom?: readonly string[];
  readonly occupancy?: Readonly<Record<string, number>>;
  readonly expect: { readonly verdict: string; readonly ticketId: string | null };
}

const code = (ticketId: string, rev = 0, k = ORG, kid = 1) =>
  signTicketCode({ kid, ticketId, rev }, k.privateKey);
const adm = (id: string, day: string) => `${id}:${day}`;

async function scenarios(): Promise<Scenario[]> {
  const SA = idAt(SYNC - DAY, '0000000000a1');
  const SB = idAt(SYNC - DAY, '0000000000a2');
  const SC = idAt(SYNC - DAY, '0000000000a3');
  const SD = idAt(SYNC - DAY, '0000000000a4');
  const SE = idAt(SYNC - DAY, '0000000000a5');
  const knownCode = await code(KNOWN, 1);
  const out: Scenario[] = [];
  const add = (s: Scenario) => out.push(s);

  // ADR 0011: valid signature, rev equal, active, not admitted locally → admit
  add({
    name: 'admit',
    rule: 'admit',
    state: 'main',
    code: knownCode,
    expect: { verdict: 'admit', ticketId: KNOWN },
  });
  add({
    name: 'admit at a named entrance',
    rule: 'admit',
    state: 'main',
    code: knownCode,
    checkpointId: 'north',
    expect: { verdict: 'admit', ticketId: KNOWN },
  });
  // → already admitted on this device → duplicate
  add({
    name: 'duplicate: already admitted on this device today',
    rule: 'duplicate',
    state: 'main',
    code: knownCode,
    admitted: [adm(KNOWN, '2027-12-01')],
    expect: { verdict: 'duplicate', ticketId: KNOWN },
  });
  add({
    name: 'not a duplicate on the next day',
    rule: 'duplicate',
    state: 'main',
    code: knownCode,
    now: '2027-12-02T20:00:00Z',
    admitted: [adm(KNOWN, '2027-12-01')],
    expect: { verdict: 'admit', ticketId: KNOWN },
  });
  add({
    name: 'duplicate by the event’s calendar day, not UTC (9 pm Chicago is already Dec 2 in UTC)',
    rule: 'duplicate',
    state: 'main',
    code: knownCode,
    now: '2027-12-02T03:00:00Z',
    admitted: [adm(KNOWN, '2027-12-01')],
    expect: { verdict: 'duplicate', ticketId: KNOWN },
  });
  add({
    name: 'duplicate by short code',
    rule: 'duplicate',
    state: 'main',
    code: 'KNOWNAAA',
    admitted: [adm(KNOWN, '2027-12-01')],
    expect: { verdict: 'duplicate', ticketId: KNOWN },
  });
  // → rev lower than manifest → reject (superseded)
  add({
    name: 'superseded: rev 0 against manifest rev 1',
    rule: 'superseded',
    state: 'main',
    code: await code(KNOWN, 0),
    expect: { verdict: 'superseded', ticketId: KNOWN },
  });
  add({
    name: 'rev ahead of the manifest (a transfer after the last sync) → provisional',
    rule: 'provisional',
    state: 'main',
    code: await code(KNOWN, 2),
    expect: { verdict: 'provisional', ticketId: KNOWN },
  });
  // → valid, not in manifest, issued after last sync → org policy (provisional admit by default)
  add({
    name: 'provisional: issued after the last sync, policy provisional',
    rule: 'provisional',
    state: 'main',
    code: await code(LATE),
    expect: { verdict: 'provisional', ticketId: LATE },
  });
  add({
    name: 'provisional boundary: issued 1 ms after the sync',
    rule: 'provisional',
    state: 'main',
    code: await code(AFTER_SYNC),
    expect: { verdict: 'provisional', ticketId: AFTER_SYNC },
  });
  add({
    name: 'invalid boundary: issued at the sync instant exactly',
    rule: 'reject',
    state: 'main',
    code: await code(AT_SYNC),
    expect: { verdict: 'invalid', ticketId: AT_SYNC },
  });
  add({
    name: 'policy reject: issued after the last sync is refused',
    rule: 'provisional',
    state: 'policy-reject',
    code: await code(LATE),
    expect: { verdict: 'invalid', ticketId: LATE },
  });
  add({
    name: 'a provisional admit scanned again on this device → duplicate',
    rule: 'duplicate',
    state: 'main',
    code: await code(LATE),
    admitted: [adm(LATE, '2027-12-01')],
    expect: { verdict: 'duplicate', ticketId: LATE },
  });
  // → not in manifest, issued before last sync → reject
  add({
    name: 'invalid: not in the manifest, issued before the last sync',
    rule: 'reject',
    state: 'main',
    code: await code(OLD_UNKNOWN),
    expect: { verdict: 'invalid', ticketId: OLD_UNKNOWN },
  });
  // → bad signature → reject
  add({
    name: 'invalid: signed by another key',
    rule: 'bad signature',
    state: 'main',
    code: await code(KNOWN, 1, OTHER),
    expect: { verdict: 'invalid', ticketId: null },
  });
  add({
    name: 'invalid: signature tampered',
    rule: 'bad signature',
    state: 'main',
    code: `${knownCode.slice(0, -1)}${knownCode.endsWith('A') ? 'B' : 'A'}`,
    expect: { verdict: 'invalid', ticketId: null },
  });
  add({
    name: 'invalid: unknown key id',
    rule: 'bad signature',
    state: 'main',
    code: await code(KNOWN, 1, OTHER, 9),
    expect: { verdict: 'invalid', ticketId: null },
  });
  add({
    name: 'invalid: garbage after the YY1 prefix',
    rule: 'bad signature',
    state: 'main',
    code: 'YY1NOTACODE',
    expect: { verdict: 'invalid', ticketId: null },
  });
  add({
    name: 'lower-case code body still verifies (the scanner upper-cases)',
    rule: 'admit',
    state: 'main',
    code: `yy1${knownCode.slice(3).toLowerCase()}`,
    expect: { verdict: 'admit', ticketId: KNOWN },
  });

  // Short codes.
  add({
    name: 'short code, any case, with spaces',
    rule: 'short code',
    state: 'main',
    code: ' knownaaa ',
    expect: { verdict: 'admit', ticketId: KNOWN },
  });
  add({
    name: 'unknown short code',
    rule: 'short code',
    state: 'main',
    code: 'NOPE2345',
    expect: { verdict: 'invalid', ticketId: null },
  });

  // Shared event rules.
  add({
    name: 'void ticket',
    rule: 'rules',
    state: 'main',
    code: await code(VOIDED),
    expect: { verdict: 'void', ticketId: VOIDED },
  });
  add({
    name: 'access date: not today',
    rule: 'rules',
    state: 'main',
    code: await code(GALA),
    expect: { verdict: 'not_today', ticketId: GALA },
  });
  add({
    name: 'access date: today',
    rule: 'rules',
    state: 'main',
    code: await code(GALA),
    now: '2027-12-02T20:00:00Z',
    expect: { verdict: 'admit', ticketId: GALA },
  });
  add({
    name: 'before the doors open',
    rule: 'rules',
    state: 'main',
    code: knownCode,
    now: '2027-11-30T00:00:00Z',
    expect: { verdict: 'outside_window', ticketId: KNOWN },
  });
  add({
    name: 'window opens 6 h before the start (exactly)',
    rule: 'rules',
    state: 'main',
    code: knownCode,
    now: '2027-12-01T09:00:00Z',
    expect: { verdict: 'admit', ticketId: KNOWN },
  });
  add({
    name: 'window not yet open (1 ms before)',
    rule: 'rules',
    state: 'main',
    code: knownCode,
    now: '2027-12-01T08:59:59.999Z',
    expect: { verdict: 'outside_window', ticketId: KNOWN },
  });
  add({
    name: 'window closes 6 h after the end (exactly)',
    rule: 'rules',
    state: 'main',
    code: knownCode,
    now: '2027-12-03T10:00:00Z',
    expect: { verdict: 'admit', ticketId: KNOWN },
  });
  add({
    name: 'window closed (1 ms after)',
    rule: 'rules',
    state: 'main',
    code: knownCode,
    now: '2027-12-03T10:00:00.001Z',
    expect: { verdict: 'outside_window', ticketId: KNOWN },
  });

  // Migrated (legacy) QR codes: case-sensitive, before short codes.
  add({
    name: 'legacy payload',
    rule: 'legacy',
    state: 'main',
    code: 'AbC-123-xyz',
    expect: { verdict: 'admit', ticketId: MIGRATED },
  });
  add({
    name: 'legacy payload, JSON wrapper',
    rule: 'legacy',
    state: 'main',
    code: '{"order_number":"172633440000017","event":3}',
    expect: { verdict: 'admit', ticketId: MIGRATED },
  });
  add({
    name: 'legacy payload, other case is a different payload',
    rule: 'legacy',
    state: 'main',
    code: 'abc-123-xyz',
    expect: { verdict: 'invalid', ticketId: null },
  });
  add({
    name: 'legacy payload not in the manifest',
    rule: 'legacy',
    state: 'main',
    code: 'ZZZ-999-zzz',
    expect: { verdict: 'invalid', ticketId: null },
  });
  add({
    name: 'legacy payload twice → duplicate',
    rule: 'legacy',
    state: 'main',
    code: 'AbC-123-xyz',
    admitted: [adm(MIGRATED, '2027-12-01')],
    expect: { verdict: 'duplicate', ticketId: MIGRATED },
  });
  add({
    name: 'a manifest without legacy codes does not read legacy payloads',
    rule: 'legacy',
    state: 'no-legacy',
    code: 'AbC-123-xyz',
    expect: { verdict: 'invalid', ticketId: null },
  });
  add({
    name: 'a version 1 manifest (no scope) still scans',
    rule: 'manifest v1',
    state: 'manifest-v1',
    code: knownCode,
    expect: { verdict: 'admit', ticketId: KNOWN },
  });

  // Checkpoints.
  add({
    name: 'zone grants its ticket type',
    rule: 'zone',
    state: 'main',
    code: await code(GALA),
    now: '2027-12-02T20:00:00Z',
    checkpointId: 'vip',
    expect: { verdict: 'granted', ticketId: GALA },
  });
  add({
    name: 'zone refuses other types',
    rule: 'zone',
    state: 'main',
    code: knownCode,
    checkpointId: 'vip',
    expect: { verdict: 'no_access', ticketId: KNOWN },
  });
  add({
    name: 'zones allow re-entry',
    rule: 'zone',
    state: 'main',
    code: await code(GALA),
    now: '2027-12-02T20:00:00Z',
    checkpointId: 'vip',
    admitted: [adm(GALA, '2027-12-02')],
    expect: { verdict: 'granted', ticketId: GALA },
  });
  add({
    name: 'event rules come first at a zone',
    rule: 'zone',
    state: 'main',
    code: await code(GALA),
    checkpointId: 'vip',
    expect: { verdict: 'not_today', ticketId: GALA },
  });
  add({
    name: 'an unknown-but-signed pass only enters an all-types zone',
    rule: 'zone',
    state: 'main',
    code: await code(LATE),
    checkpointId: 'vip',
    expect: { verdict: 'no_access', ticketId: LATE },
  });
  add({
    name: 'an unknown-but-signed pass enters an all-types zone',
    rule: 'zone',
    state: 'main',
    code: await code(LATE),
    checkpointId: 'hall',
    expect: { verdict: 'granted', ticketId: LATE },
  });
  add({
    name: 'a scoped device admits at its checkpoint',
    rule: 'scope',
    state: 'scoped-north',
    code: knownCode,
    checkpointId: 'north',
    expect: { verdict: 'admit', ticketId: KNOWN },
  });
  add({
    name: 'a scoped device refuses another checkpoint',
    rule: 'scope',
    state: 'scoped-north',
    code: knownCode,
    checkpointId: 'hall',
    expect: { verdict: 'wrong_checkpoint', ticketId: null },
  });
  add({
    name: 'a scoped device refuses the whole event',
    rule: 'scope',
    state: 'scoped-north',
    code: knownCode,
    checkpointId: null,
    expect: { verdict: 'wrong_checkpoint', ticketId: null },
  });

  // Multi-date events.
  const occ = (n: number) => idAt(SYNC - DAY, `0000000000b${n}`);
  add({
    name: 'ticket for today’s date admits',
    rule: 'occurrence',
    state: 'multi-date',
    code: await code(occ(1)),
    expect: { verdict: 'admit', ticketId: occ(1) },
  });
  add({
    name: 'ticket for tomorrow’s date is too early',
    rule: 'occurrence',
    state: 'multi-date',
    code: await code(occ(2)),
    expect: { verdict: 'wrong_date', ticketId: occ(2) },
  });
  add({
    name: 'ticket for tomorrow’s date admits on its day',
    rule: 'occurrence',
    state: 'multi-date',
    code: await code(occ(2)),
    now: '2027-12-02T20:00:00Z',
    expect: { verdict: 'admit', ticketId: occ(2) },
  });
  add({
    name: 'ticket for a cancelled date',
    rule: 'occurrence',
    state: 'multi-date',
    code: await code(occ(3)),
    expect: { verdict: 'wrong_date', ticketId: occ(3) },
  });
  add({
    name: 'ticket for a date missing from the manifest',
    rule: 'occurrence',
    state: 'multi-date',
    code: await code(occ(4)),
    expect: { verdict: 'wrong_date', ticketId: occ(4) },
  });

  // Session doors (manifest v3).
  const room = (
    checkpointId: string,
    c: string,
    over: Partial<Scenario> & { expect: Scenario['expect'] },
  ): Scenario => ({
    name: '',
    rule: 'session',
    state: 'sessions',
    code: c,
    checkpointId,
    ...over,
  });
  const sess = (name: string, s: Scenario) => add({ ...s, name });
  sess(
    'enrolled registrant enters',
    room('room-a', 'SESSAAAA', { expect: { verdict: 'entered', ticketId: SA } }),
  );
  sess(
    'already in the room → duplicate',
    room('room-a', 'SESSAAAA', { inRoom: [`${SA}@s1`], expect: { verdict: 'duplicate', ticketId: SA } }),
  );
  sess(
    'scan out of someone seen going in',
    room('room-a', 'SESSAAAA', {
      direction: 'out',
      inRoom: [`${SA}@s1`],
      expect: { verdict: 'scanned_out', ticketId: SA },
    }),
  );
  sess(
    'scan out of someone never seen going in',
    room('room-a', 'SESSAAAA', { direction: 'out', expect: { verdict: 'not_in_room', ticketId: SA } }),
  );
  sess(
    'admission level: the pass does not include the session',
    room('room-a', 'SESSBBBB', { expect: { verdict: 'admission_level', ticketId: SB } }),
  );
  sess(
    'enrollment: registrant not enrolled in an enrollment-required session',
    room('room-a', 'SESSCCCC', { expect: { verdict: 'not_enrolled', ticketId: SC } }),
  );
  sess(
    'enrollment: not a registrant',
    room('room-a', 'SESSDDDD', { expect: { verdict: 'not_enrolled', ticketId: SD } }),
  );
  sess(
    'capacity: the room is full',
    room('room-a', 'SESSAAAA', { occupancy: { s1: 2 }, expect: { verdict: 'capacity', ticketId: SA } }),
  );
  sess(
    'capacity: one place left',
    room('room-a', 'SESSAAAA', { occupancy: { s1: 1 }, expect: { verdict: 'entered', ticketId: SA } }),
  );
  sess(
    'event rules still apply: void pass',
    room('room-a', 'SESSEEEE', { expect: { verdict: 'void', ticketId: SE } }),
  );
  sess(
    'a session without enrollment: any registrant with the level enters',
    room('room-b', 'SESSAAAA', { expect: { verdict: 'entered', ticketId: SA } }),
  );
  sess(
    'a pass listing the session enters it',
    room('room-b', 'SESSBBBB', { expect: { verdict: 'entered', ticketId: SB } }),
  );
  sess(
    'a session with capacity 1: full',
    room('room-c', 'SESSAAAA', { occupancy: { s3: 1 }, expect: { verdict: 'capacity', ticketId: SA } }),
  );
  sess(
    'a session with capacity 1: empty',
    room('room-c', 'SESSAAAA', { occupancy: { s3: 0 }, expect: { verdict: 'entered', ticketId: SA } }),
  );
  sess(
    'an unknown-but-signed pass is refused where enrollment is required',
    room('room-a', await code(LATE), { expect: { verdict: 'not_enrolled', ticketId: LATE } }),
  );
  sess(
    'an unknown-but-signed pass enters where it is not',
    room('room-b', await code(LATE), { expect: { verdict: 'entered', ticketId: LATE } }),
  );
  sess(
    'a session door without a signed gate admits nobody',
    room('room-x', 'SESSAAAA', { expect: { verdict: 'invalid', ticketId: SA } }),
  );
  sess(
    'a session door still refuses a bad signature',
    room('room-b', await code(SA, 0, OTHER), { expect: { verdict: 'invalid', ticketId: null } }),
  );
  sess(
    'an entrance of the same manifest behaves like the event',
    room('north', 'SESSAAAA', { expect: { verdict: 'admit', ticketId: SA } }),
  );
  return out;
}

// ── lookup hashes and holder search ──────────────────────────────────────────────────────────────
function lookupVectors() {
  const emails = [
    'ada@example.test',
    ' Ada@Example.test ',
    'ADA@EXAMPLE.TEST',
    '\tada@example.test\n',
    'sam+tag@example.test',
    'ÁDA@example.test',
  ];
  const phones: [string, string | null][] = [
    ['+14155550134', '55550134'],
    ['+1 (415) 555-0134', '55550134'],
    ['415 555 0134', '55550134'],
    ['(415)555-0134', '55550134'],
    ['415.555.0134', '55550134'],
    ['4155550134', '55550134'],
    ['+442071838750', '71838750'],
    ['+81 3-1234-5678', '12345678'],
    ['+4915112345678', '12345678'],
    ['1234567', null],
    ['555-013', null],
    ['', null],
    ['ext. 12', null],
  ];
  const kinds: [string, string][] = [
    ['  Ana@Example.com ', 'email'],
    ['a@', 'email'],
    ['+1 (415) 555-0134', 'phone'],
    ['4155550134', 'phone'],
    ['415.555.0134', 'phone'],
    ['5550', 'name'],
    ['1234567', 'name'],
    ['José', 'name'],
    ['Ada Lovelace', 'name'],
    ['12 Main St', 'name'],
    ['+1 abc 4155550134', 'name'],
    ['', 'name'],
  ];
  // A small holder list for the search results.
  const people: [string, string, string, string | null, 'active' | 'void'][] = [
    ['0192f000-0000-7000-8000-0000000000c1', 'Ada Lovelace', 'ada@example.test', '+14155550134', 'active'],
    ['0192f000-0000-7000-8000-0000000000c2', 'Ada Byron', 'ada.byron@example.test', null, 'active'],
    [
      '0192f000-0000-7000-8000-0000000000c3',
      'José María Núñez',
      'jose@example.test',
      '+34 612 345 678',
      'active',
    ],
    ['0192f000-0000-7000-8000-0000000000c4', 'Zed Zebra', 'zed@example.test', '+442071838750', 'void'],
    ['0192f000-0000-7000-8000-0000000000c5', 'Zed Able', 'zed2@example.test', null, 'active'],
    ['0192f000-0000-7000-8000-0000000000c6', "Dara O'Neil", 'dara@example.test', null, 'active'],
  ];
  const rows = people.map(([ticketId, holderName, email, phone, status], i) =>
    row(ticketId, `HOLDER${i + 1}`, {
      holderName,
      status,
      emailHash: emailHash(email),
      ...(phone ? { phoneHash: phoneHash(phone.replace(/\D/g, '').slice(-8)) } : {}),
    }),
  );
  const [c1, c2, c3, c4, c5, c6] = people.map((p) => p[0]);
  const searches: [string, string[]][] = [
    ['ada@example.test', [c1 as string]],
    ['  ADA@Example.Test ', [c1 as string]],
    ['nobody@example.test', []],
    ['+1 415 555 0134', [c1 as string]],
    ['(415) 555-0134', [c1 as string]],
    ['612345678', [c3 as string]],
    ['020 7183 8750', [c4 as string]],
    ['999 999 9999', []],
    ['ada', [c2 as string, c1 as string]],
    ['ada lo', [c1 as string]],
    ['lovelace ada', [c1 as string]],
    ['jose nun', [c3 as string]],
    ['MARIA', [c3 as string]],
    ['ose', []],
    ['oneil', [c6 as string]],
    ["o'neil dara", [c6 as string]],
    ['zed', [c5 as string, c4 as string]],
    ['a', []],
    ['', []],
  ];
  return {
    salt: SALT,
    emails: emails.map((v) => ({ value: v, hash: emailHash(v.toLowerCase().trim()) })),
    phones: phones.map(([v, key]) => ({ value: v, key, hash: key ? phoneHash(key) : null })),
    kinds: kinds.map(([query, kind]) => ({ query, kind })),
    otherSalt: {
      salt: 'yy-manifest:e2',
      value: 'ada@example.test',
      hash: hash('yy-manifest:e2:ada@example.test'),
    },
    rows,
    searches: searches.map(([query, ids]) => ({ query, ids })),
  };
}

// ── first wins, with clock offsets ───────────────────────────────────────────────────────────────
function firstWinsVectors() {
  const offsets = [
    // The server stamped its time somewhere between sending and receiving; the estimate is the value
    // of the interval [server − received, server − sent] closest to zero.
    {
      name: 'a good clock: the interval contains zero',
      serverTime: 1_000,
      sentAt: 900,
      receivedAt: 1_100,
      expect: 0,
    },
    {
      name: 'a slow device: behind by at least 4900 ms',
      serverTime: 10_000,
      sentAt: 4_900,
      receivedAt: 5_100,
      expect: 4_900,
    },
    {
      name: 'a fast device: ahead by at least 4000 ms',
      serverTime: 1_000,
      sentAt: 5_000,
      receivedAt: 5_200,
      expect: -4_000,
    },
    {
      name: 'sent and received swapped',
      serverTime: 1_000,
      sentAt: 5_200,
      receivedAt: 5_000,
      expect: -4_000,
    },
    { name: 'lower bound exactly zero', serverTime: 1_000, sentAt: 500, receivedAt: 1_000, expect: 0 },
    { name: 'upper bound exactly zero', serverTime: 1_000, sentAt: 1_000, receivedAt: 1_500, expect: 0 },
    {
      name: 'instant round trip, clock right',
      serverTime: 2_000,
      sentAt: 2_000,
      receivedAt: 2_000,
      expect: 0,
    },
  ];
  const NOW_ISO = '2027-12-01T12:30:00.000Z';
  const corrected = [
    {
      name: 'no offset',
      deviceTs: '2027-12-01T12:00:00.000Z',
      offsetMs: 0,
      now: NOW_ISO,
      expect: '2027-12-01T12:00:00.000Z',
    },
    {
      name: 'a slow clock is moved forward',
      deviceTs: '2027-12-01T12:00:00.000Z',
      offsetMs: 5_000,
      now: NOW_ISO,
      expect: '2027-12-01T12:00:05.000Z',
    },
    {
      name: 'a fast clock is moved back',
      deviceTs: '2027-12-01T12:00:05.000Z',
      offsetMs: -10_000,
      now: NOW_ISO,
      expect: '2027-12-01T11:59:55.000Z',
    },
    {
      name: 'never later than now (a clock hours ahead)',
      deviceTs: '2027-12-01T15:00:00.000Z',
      offsetMs: 0,
      now: NOW_ISO,
      expect: NOW_ISO,
    },
    { name: 'exactly now', deviceTs: NOW_ISO, offsetMs: 0, now: NOW_ISO, expect: NOW_ISO },
  ];
  const earlier = [
    { name: 'nothing recorded yet', current: null, candidate: '2027-12-01T12:00:00.000Z', expect: true },
    {
      name: 'earlier replaces',
      current: '2027-12-01T12:00:01.000Z',
      candidate: '2027-12-01T12:00:00.000Z',
      expect: true,
    },
    {
      name: 'a millisecond earlier replaces',
      current: '2027-12-01T12:00:00.001Z',
      candidate: '2027-12-01T12:00:00.000Z',
      expect: true,
    },
    {
      name: 'later does not',
      current: '2027-12-01T12:00:00.000Z',
      candidate: '2027-12-01T12:00:00.001Z',
      expect: false,
    },
    {
      name: 'a tie keeps the first recorded',
      current: '2027-12-01T12:00:00.000Z',
      candidate: '2027-12-01T12:00:00.000Z',
      expect: false,
    },
  ];
  // Two or three devices admit the same ticket offline; whatever order their uploads arrive in, the
  // earliest corrected scan wins and the others become duplicate_offline.
  const races = [
    {
      name: 'two good clocks: the earlier scan wins',
      now: NOW_ISO,
      arrivals: [
        { device: 'phone-1', deviceTs: '2027-12-01T12:00:00.000Z', offsetMs: 0 },
        { device: 'phone-2', deviceTs: '2027-12-01T12:00:00.500Z', offsetMs: 0 },
      ],
      winner: 'phone-1',
    },
    {
      name: 'a fast clock is corrected: the later raw timestamp is really earlier',
      now: NOW_ISO,
      arrivals: [
        { device: 'phone-1', deviceTs: '2027-12-01T12:00:05.000Z', offsetMs: -10_000 },
        { device: 'phone-2', deviceTs: '2027-12-01T12:00:00.000Z', offsetMs: 0 },
      ],
      winner: 'phone-1',
    },
    {
      name: 'a slow clock is corrected: the earlier raw timestamp is really later',
      now: NOW_ISO,
      arrivals: [
        { device: 'phone-1', deviceTs: '2027-12-01T11:59:58.000Z', offsetMs: 4_000 },
        { device: 'phone-2', deviceTs: '2027-12-01T12:00:00.000Z', offsetMs: 0 },
      ],
      winner: 'phone-2',
    },
    {
      name: 'a clock hours ahead cannot claim a future moment',
      now: NOW_ISO,
      arrivals: [
        { device: 'phone-1', deviceTs: '2027-12-01T15:00:00.000Z', offsetMs: 0 },
        { device: 'phone-2', deviceTs: '2027-12-01T12:10:00.000Z', offsetMs: 0 },
      ],
      winner: 'phone-2',
    },
    {
      name: 'three devices',
      now: NOW_ISO,
      arrivals: [
        { device: 'phone-1', deviceTs: '2027-12-01T12:00:10.000Z', offsetMs: 0 },
        { device: 'phone-2', deviceTs: '2027-12-01T12:00:12.000Z', offsetMs: -4_000 },
        { device: 'phone-3', deviceTs: '2027-12-01T12:00:09.000Z', offsetMs: 0 },
      ],
      winner: 'phone-2',
    },
  ];
  return { offsets, corrected, earlier, races };
}

// ── signed manifest scopes ───────────────────────────────────────────────────────────────────────
async function scopeVectors() {
  const sigOf = async (base: Omit<ManifestScope, 'signature'>, k = ORG, kid = 1) =>
    signStatement(SCOPE_TAG, scopeMessage(base), kid, k.privateKey);
  const base = { eventId: 'e1', deviceId: 'd1', checkpointIds: ['north', 'hall'] as string[] | null };
  const good: ManifestScope = { ...base, signature: await sigOf(base) };
  const unordered = { eventId: 'e1', deviceId: 'd1', checkpointIds: ['hall', 'north'] };
  const gate = (over: Partial<SignedSessionGate> = {}): SignedSessionGate => ({
    checkpointId: 'room-a',
    sessionId: 's1',
    capacity: 2,
    enrollmentRequired: true,
    enrolled: ['t-a', 't-b'],
    ...over,
  });
  const withGates = async (g: SignedSessionGate[]) => {
    const b = { eventId: 'e1', deviceId: 'd1', checkpointIds: null, sessionGates: g };
    return { ...b, signature: await sigOf(b) } as ManifestScope;
  };
  const sessionCheckpoint = {
    id: 'room-a',
    name: 'Room A',
    kind: 'session',
    ticketTypeIds: [],
    sessionId: 's1',
  } as const;
  const gated = await withGates([gate()]);
  const h = (over: Partial<ManifestHeader> = {}): ManifestHeader => header(over);
  return [
    { name: 'signed by the org key', header: h({ scope: good }), expect: true },
    {
      name: 'checkpoint ids in another order',
      header: h({ scope: { ...unordered, signature: await sigOf(unordered) } }),
      expect: true,
    },
    {
      name: 'checkpoints widened',
      header: h({ scope: { ...good, checkpointIds: ['north', 'hall', 'vip'] } }),
      expect: false,
    },
    {
      name: 'scope removed from the checkpoints (whole event)',
      header: h({ scope: { ...good, checkpointIds: null } }),
      expect: false,
    },
    { name: 'device re-targeted', header: h({ scope: { ...good, deviceId: 'd2' } }), expect: false },
    {
      name: 'event re-targeted in the scope',
      header: h({ scope: { ...good, eventId: 'e2' } }),
      expect: false,
    },
    {
      name: 'scope of another event in this header',
      header: h({ scope: { ...good, eventId: 'e2', signature: await sigOf({ ...base, eventId: 'e2' }) } }),
      expect: false,
    },
    {
      name: 'signed by another key',
      header: h({ scope: { ...good, signature: await sigOf(base, OTHER) } }),
      expect: false,
    },
    {
      name: 'signed with an unknown key id',
      header: h({ scope: { ...good, signature: await sigOf(base, ORG, 9) } }),
      expect: false,
    },
    { name: 'garbage signature', header: h({ scope: { ...good, signature: 'not-base64!' } }), expect: false },
    { name: 'a current-version manifest without a scope', header: h({}), expect: false },
    {
      name: 'version 1 manifest without a scope',
      header: (({ version: _v, ...rest }) => rest)(h({})) as ManifestHeader,
      expect: true,
    },
    {
      name: 'session checkpoint with signed gates',
      header: h({ checkpoints: [sessionCheckpoint], scope: gated }),
      expect: true,
    },
    {
      name: 'session checkpoint without gates in the scope',
      header: h({ checkpoints: [sessionCheckpoint], scope: good }),
      expect: false,
    },
    {
      name: 'gate capacity widened',
      header: h({
        checkpoints: [sessionCheckpoint],
        scope: { ...gated, sessionGates: [gate({ capacity: 500 })] },
      }),
      expect: false,
    },
    {
      name: 'a place added to the enrolled list',
      header: h({
        checkpoints: [sessionCheckpoint],
        scope: { ...gated, sessionGates: [gate({ enrolled: ['t-a', 't-b', 't-c'] })] },
      }),
      expect: false,
    },
    {
      name: 'enrolled list in another order',
      header: h({
        checkpoints: [sessionCheckpoint],
        scope: { ...gated, sessionGates: [gate({ enrolled: ['t-b', 't-a'] })] },
      }),
      expect: true,
    },
  ];
}

/** Every vector file: name → content. Serialised with `serialize`. */
export async function buildVectors(): Promise<Record<string, unknown>> {
  return {
    'verdicts.json': {
      description:
        'Offline verdicts (ADR 0011). For each scenario: build the state from states[state] with `admitted`, `inRoom` and `occupancy`, run offlineVerdict(state, code, now, checkpointId, { direction }), and expect `expect`. Codes are signed by the key in each state’s header.',
      seedRule: SEED_RULE,
      now: NOW,
      states: await states(),
      scenarios: (await scenarios()).map((s) => ({
        ...s,
        now: s.now ?? NOW,
        checkpointId: s.checkpointId ?? null,
        direction: s.direction ?? 'in',
        admitted: s.admitted ?? [],
        inRoom: s.inRoom ?? [],
        occupancy: s.occupancy ?? {},
      })),
    },
    'lookup.json': {
      description:
        'Door lookup: lookupHash(salt, value) of a normalized email, phoneLookupHash(salt, phone) (last 8 digits, domain separated), lookupKind(query), and findTicketHolders(rows, salt, query).ids. Hashes by OpenSSL.',
      ...lookupVectors(),
    },
    'first-wins.json': {
      description:
        'Cross-device duplicates (ADR 0011): clockOffsetMs(sample), correctedArrival(deviceTs, offsetMs, now), earlierArrival(current, candidate), and races where the earliest corrected arrival wins whatever order uploads arrive in.',
      ...firstWinsVectors(),
    },
    'scopes.json': {
      description:
        'Signed manifest scopes: verifyManifestScope(header) must give `expect`. The public key is in each header.',
      seedRule: SEED_RULE,
      vectors: await scopeVectors(),
    },
  };
}

export const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
