import { generateKeyPair, signStatement, signTicketCode, verifyStatement } from '@yayatoh/ticket-crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MANIFEST_VERSION,
  type ManifestHeader,
  type ManifestScope,
  type OfflineState,
  offlineVerdict,
  SCOPE_TAG,
  scopeAllows,
  scopeMessage,
  verifyManifestScope,
} from '../src/index.ts';

const TICKET = '0192f000-0000-7000-8000-000000000001';
const NOW = new Date('2027-12-01T20:00:00Z');
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

async function signed(checkpointIds: string[] | null, k = keys): Promise<ManifestScope> {
  const base = { eventId: 'e1', deviceId: 'd1', checkpointIds };
  return { ...base, signature: await signStatement(SCOPE_TAG, scopeMessage(base), 1, k.privateKey) };
}

function header(scope?: ManifestScope, version: number | null = MANIFEST_VERSION): ManifestHeader {
  return {
    event: {
      id: 'e1',
      name: 'Scoped',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-03T04:00:00Z',
      timezone: 'America/Chicago',
    },
    publicKeys: { '1': b64(keys.publicKey) },
    salt: 's',
    serverTime: NOW.toISOString(),
    unknownPolicy: 'provisional',
    checkpoints: [{ id: 'north', name: 'North gate', kind: 'entrance', ticketTypeIds: [] }],
    ...(version === null ? {} : { version }),
    ...(scope ? { scope } : {}),
  };
}

function state(h: ManifestHeader): OfflineState {
  const row = {
    ticketId: TICKET,
    shortCode: 'ABCDEFGH',
    rev: 0,
    status: 'active' as const,
    ticketTypeId: 'ga',
    typeName: 'Pass',
    accessDates: [],
    holderName: 'Sam',
    emailHash: '',
    issuedAt: NOW.toISOString(),
  };
  return {
    header: h,
    byId: new Map([[TICKET, row]]),
    byShortCode: new Map([['ABCDEFGH', row]]),
    admitted: new Set(),
    lastSyncAt: NOW,
  };
}

beforeAll(async () => {
  keys = await generateKeyPair();
  other = await generateKeyPair();
});

describe('checkpoint scope (M1.9d)', () => {
  it('a scoped device admits only at its checkpoints; elsewhere (or the whole event) is wrong_checkpoint', async () => {
    const s = state(header(await signed(['north'])));
    const code = await signTicketCode({ kid: 1, ticketId: TICKET, rev: 0 }, keys.privateKey);
    expect((await offlineVerdict(s, code, NOW, 'north')).verdict).toBe('admit');
    expect((await offlineVerdict(s, code, NOW, 'south')).verdict).toBe('wrong_checkpoint');
    expect((await offlineVerdict(s, code, NOW, null)).verdict).toBe('wrong_checkpoint');
    // The refusal doesn't read the code: nothing about the ticket is shown.
    expect((await offlineVerdict(s, 'ABCDEFGH', NOW, null)).row).toBeNull();
  });

  it('an unscoped scope (null) and a version 1 manifest (no scope) allow the whole event', async () => {
    expect((await offlineVerdict(state(header(await signed(null))), 'ABCDEFGH', NOW)).verdict).toBe('admit');
    expect((await offlineVerdict(state(header(undefined, null)), 'ABCDEFGH', NOW)).verdict).toBe('admit');
    expect(scopeAllows(undefined, null)).toBe(true);
    expect(scopeAllows({ checkpointIds: [] }, 'north')).toBe(false);
  });

  it('the scope is signed: valid with the org key, invalid when widened, re-targeted or signed by another key', async () => {
    const scope = await signed(['north']);
    expect(await verifyManifestScope(header(scope))).toBe(true);
    expect(await verifyManifestScope(header({ ...scope, checkpointIds: ['north', 'south'] }))).toBe(false);
    expect(await verifyManifestScope(header({ ...scope, checkpointIds: null }))).toBe(false);
    expect(await verifyManifestScope(header({ ...scope, deviceId: 'd2' }))).toBe(false);
    expect(await verifyManifestScope(header({ ...scope, eventId: 'e2' }))).toBe(false);
    expect(await verifyManifestScope(header(await signed(['north'], other)))).toBe(false);
    expect(await verifyManifestScope(header({ ...scope, signature: 'not-base64!' }))).toBe(false);
  });

  it('the id order does not matter; a v2 manifest without a scope is rejected, a v1 one is accepted', async () => {
    const base = { eventId: 'e1', deviceId: 'd1', checkpointIds: ['b', 'a'] };
    const sig = await signStatement(SCOPE_TAG, scopeMessage(base), 1, keys.privateKey);
    expect(await verifyManifestScope(header({ ...base, checkpointIds: ['a', 'b'], signature: sig }))).toBe(
      true,
    );
    expect(await verifyManifestScope(header(undefined))).toBe(false);
    expect(await verifyManifestScope(header(undefined, null))).toBe(true);
  });

  it('statement signatures are domain separated from each other', async () => {
    const pub = new Map([[1, keys.publicKey]]);
    const sig = await signStatement('a', 'm', 1, keys.privateKey);
    expect(await verifyStatement('a', 'm', sig, pub)).toBe(true);
    expect(await verifyStatement('b', 'm', sig, pub)).toBe(false);
    expect(await verifyStatement('a', 'm', sig, new Map([[2, keys.publicKey]]))).toBe(false);
  });
});
