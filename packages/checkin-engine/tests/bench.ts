import { createHash } from 'node:crypto';
import {
  base32Decode,
  CODE_PREFIX,
  ed25519KeyPairFromSeed,
  legacyPayloadHash,
  signTicketCode,
  verifyTicketCode,
} from '@yayatoh/ticket-crypto';
import { lookupHash, type ManifestRow, type OfflineState, offlineVerdict } from '../src/index.ts';

/**
 * Door cost per code (M7.1a): `pnpm --filter @yayatoh/checkin-engine bench`. Times the pure-JS
 * verifier alone and the whole offline verdict (verify + manifest lookup + event rules) over
 * distinct signed codes, plus the email lookup hash. The numbers go in the spec; M7.4b repeats
 * them on a phone (Hermes) to check the door still decides in well under a second.
 */
const N = Number(process.env.BENCH_CODES ?? 2000);
const WARMUP = 200;
const seed = new Uint8Array(createHash('sha256').update('yayatoh-test-vector-key:bench').digest());
const { publicKey, privateKey } = ed25519KeyPairFromSeed(seed);
const keys = new Map([[1, publicKey]]);

const SYNC = Date.parse('2027-12-01T12:00:00Z');
const idOf = (i: number) =>
  `${(SYNC - 86_400_000)
    .toString(16)
    .padStart(12, '0')
    .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-${i.toString(16).padStart(12, '0')}`;

const ids = Array.from({ length: N + WARMUP }, (_, i) => idOf(i + 1));
const codes = await Promise.all(
  ids.map((ticketId) => signTicketCode({ kid: 1, ticketId, rev: 0 }, privateKey)),
);
const rows: ManifestRow[] = ids.map((ticketId, i) => ({
  ticketId,
  shortCode: `B${i.toString(36).toUpperCase().padStart(7, '0')}`,
  rev: 0,
  status: 'active',
  ticketTypeId: 'type-ga',
  typeName: 'General',
  accessDates: [],
  holderName: 'Bench',
  emailHash: '',
  issuedAt: new Date(SYNC - 86_400_000).toISOString(),
}));
const state: OfflineState = {
  header: {
    event: {
      id: 'e1',
      name: 'Bench',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-03T04:00:00Z',
      timezone: 'America/Chicago',
    },
    publicKeys: { '1': Buffer.from(publicKey).toString('base64') },
    salt: 'yy-manifest:e1',
    serverTime: new Date(SYNC).toISOString(),
    unknownPolicy: 'provisional',
    checkpoints: [],
  },
  byId: new Map(rows.map((r) => [r.ticketId, r])),
  byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
  admitted: new Set(),
  lastSyncAt: new Date(SYNC),
};
const now = new Date('2027-12-01T20:00:00Z');

async function time(label: string, run: (i: number) => Promise<unknown>) {
  for (let i = 0; i < WARMUP; i++) await run(i);
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await run(WARMUP + i);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] as number;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    operation: label,
    codes: N,
    'mean ms': +mean.toFixed(3),
    'p50 ms': +at(0.5).toFixed(3),
    'p95 ms': +at(0.95).toFixed(3),
    'p99 ms': +at(0.99).toFixed(3),
    'max ms': +(samples.at(-1) as number).toFixed(3),
    'codes/s': Math.round(1000 / mean),
  };
}

// Reference only: what Node's Web Crypto does for the same signatures (the code this replaced).
const subtleKey = await globalThis.crypto.subtle.importKey(
  'raw',
  new Uint8Array(publicKey),
  { name: 'Ed25519' },
  false,
  ['verify'],
);
const subtleVerify = async (code: string) => {
  const bytes = base32Decode(code.slice(CODE_PREFIX.length)) as Uint8Array;
  const message = new Uint8Array([...new TextEncoder().encode('yayatoh-ticket-v1'), ...bytes.slice(0, 21)]);
  return globalThis.crypto.subtle.verify({ name: 'Ed25519' }, subtleKey, bytes.slice(21), message);
};

const results = [
  await time('verifyTicketCode', (i) => verifyTicketCode(codes[i] as string, keys)),
  await time('offlineVerdict (admit path)', (i) => offlineVerdict(state, codes[i] as string, now)),
  await time('Web Crypto verify (reference)', (i) => subtleVerify(codes[i] as string)),
  await time('lookupHash (email)', (i) => lookupHash('yy-manifest:e1', `holder${i}@example.test`)),
  await time('legacyPayloadHash', (i) => legacyPayloadHash('yy-manifest:e1', `172633440${i}`)),
];
console.info(`node ${process.version} ${process.platform}/${process.arch}`);
for (const r of results) console.info(JSON.stringify(r));
