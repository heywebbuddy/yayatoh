import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto';
import { base32Decode, base32Encode } from '../src/index.ts';

/**
 * The fixed test vectors of the door's cryptography (M7.1a). Every Ed25519 signature and SHA-256
 * digest here comes from Node's OpenSSL, NOT from the package under test, and every expectation is a
 * literal written below (from ADR 0011 and the RFCs), never the package's own output. So the
 * vectors prove the pure-JavaScript code agrees with an independent implementation, on Node today
 * and on Hermes in the app later. Ed25519 is deterministic: regenerating gives identical files.
 *
 * `pnpm --filter @yayatoh/ticket-crypto vectors:write` rewrites `vectors/*.json`; `vectors.test.ts`
 * fails when the committed files differ from what this script produces.
 */

// ── fixed keys ──────────────────────────────────────────────────────────────────────────────────
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest();
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
export const SEED_RULE = "seed = SHA-256('yayatoh-test-vector-key:' + label)";

interface FixedKey {
  readonly label: string;
  readonly priv: KeyObject;
  readonly publicKey: Buffer;
}

export function fixedKey(label: string): FixedKey {
  const seed = sha256(`yayatoh-test-vector-key:${label}`);
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const jwk = createPublicKey(priv).export({ format: 'jwk' });
  return { label, priv, publicKey: Buffer.from(jwk.x as string, 'base64url') };
}

/** kid → key label. kid 9 and the attacker key are never in a verifier's key set. */
const KEYS: Readonly<Record<number, string>> = {
  1: 'org-a',
  2: 'org-a-rotated',
  7: 'org-b',
  65535: 'org-max',
};
const keyOf = Object.fromEntries(Object.entries(KEYS).map(([kid, label]) => [Number(kid), fixedKey(label)]));
const attacker = fixedKey('attacker');
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const publicKeys = Object.fromEntries(Object.entries(keyOf).map(([kid, k]) => [kid, b64(k.publicKey)]));

// ── ticket codes (ADR 0011: "YY1" + base32(payload ‖ signature)) ─────────────────────────────────
const TAG = Buffer.from('yayatoh-ticket-v1');
const T1 = '0192f000-0000-7000-8000-000000000001';
const T2 = '01980a2b-3c4d-7e5f-9a6b-7c8d9e0f1a2b';
const T3 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const T4 = '00000000-0000-0000-0000-000000000000';

function payload(version: number, kid: number, ticketId: string, rev: number): Buffer {
  const p = Buffer.alloc(21);
  p[0] = version;
  p.writeUInt16BE(kid, 1);
  Buffer.from(ticketId.replace(/-/g, ''), 'hex').copy(p, 3);
  p.writeUInt16BE(rev, 19);
  return p;
}

function codeOf(p: Buffer, key: FixedKey): string {
  const sig = sign(null, Buffer.concat([TAG, p]), key.priv);
  return `YY1${base32Encode(Buffer.concat([p, sig]))}`;
}

const issue = (kid: number, ticketId: string, rev: number, key: FixedKey = keyOf[kid] as FixedKey) =>
  codeOf(payload(1, kid, ticketId, rev), key);

/** Edit the decoded bytes of a code and re-encode it. */
function mutate(code: string, edit: (bytes: Uint8Array) => void): string {
  const bytes = base32Decode(code.slice(3)) as Uint8Array;
  edit(bytes);
  return `YY1${base32Encode(bytes)}`;
}

/** The group order of Ed25519; adding it to S makes a malleable, non-canonical signature. */
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
function addGroupOrderToS(bytes: Uint8Array, offset: number): void {
  let s = 0n;
  for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(bytes[offset + 32 + i] as number);
  s += L;
  for (let i = 0; i < 32; i++) {
    bytes[offset + 32 + i] = Number(s & 255n);
    s >>= 8n;
  }
}

interface CodeVector {
  readonly name: string;
  readonly note?: string;
  readonly code: string;
  /** The kids whose public keys the verifier holds. */
  readonly kids: readonly number[];
  readonly expect: { ok: true; kid: number; ticketId: string; rev: number } | { ok: false; reason: string };
}

const ALL = [1, 2, 7, 65535];
const ok = (kid: number, ticketId: string, rev: number) => ({ ok: true as const, kid, ticketId, rev });
const fail = (reason: string) => ({ ok: false as const, reason });

function codeVectors(): CodeVector[] {
  const v1 = issue(1, T1, 0);
  const flip = (c: string, at: number) => c.slice(0, at) + (c[at] === 'A' ? 'B' : 'A') + c.slice(at + 1);
  const v: CodeVector[] = [
    // Valid codes, several key ids, edge values of kid and rev, a superseded-rev family.
    { name: 'valid kid 1 rev 0', code: v1, kids: ALL, expect: ok(1, T1, 0) },
    { name: 'valid kid 1 rev 1', code: issue(1, T1, 1), kids: ALL, expect: ok(1, T1, 1) },
    { name: 'valid kid 1 rev 2', code: issue(1, T1, 2), kids: ALL, expect: ok(1, T1, 2) },
    { name: 'valid kid 2 (rotated key)', code: issue(2, T2, 3), kids: ALL, expect: ok(2, T2, 3) },
    { name: 'valid kid 7, rev 65535', code: issue(7, T2, 65535), kids: ALL, expect: ok(7, T2, 65535) },
    { name: 'valid kid 65535', code: issue(65535, T3, 0), kids: ALL, expect: ok(65535, T3, 0) },
    { name: 'valid all-zero ticket id', code: issue(1, T4, 0), kids: ALL, expect: ok(1, T4, 0) },
    { name: 'valid with only its own key', code: issue(7, T1, 0), kids: [7], expect: ok(7, T1, 0) },
    {
      name: 'valid, body in lower case',
      note: 'the verifier upper-cases the body (not the YY1 prefix)',
      code: `YY1${v1.slice(3).toLowerCase()}`,
      kids: ALL,
      expect: ok(1, T1, 0),
    },
    {
      name: 'valid, trailing newline',
      note: 'the body is trimmed',
      code: `${v1}\n`,
      kids: ALL,
      expect: ok(1, T1, 0),
    },
    {
      name: 'valid, one extra base32 character',
      note: 'a lone trailing character carries no whole byte, so it is ignored (current behaviour, frozen)',
      code: `${v1}A`,
      kids: ALL,
      expect: ok(1, T1, 0),
    },
    // Wrong or unknown keys.
    { name: 'unknown key id', code: issue(9, T1, 0, attacker), kids: ALL, expect: fail('unknown_key') },
    {
      name: 'key id not in this verifier’s set',
      code: issue(2, T2, 3),
      kids: [1],
      expect: fail('unknown_key'),
    },
    {
      name: 'signed by another key under a known key id',
      code: issue(1, T1, 0, attacker),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    {
      name: 'signed by key 2 but claiming key 1',
      code: codeOf(payload(1, 1, T1, 0), keyOf[2] as FixedKey),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    // Tampering.
    {
      name: 'tampered signature (first char)',
      code: flip(v1, 3 + 34),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    {
      name: 'tampered signature (middle char)',
      code: flip(v1, 3 + 90),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    {
      name: 'tampered signature (last char)',
      code: flip(v1, v1.length - 1),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    {
      name: 'tampered rev (signature kept)',
      code: mutate(issue(1, T1, 0), (b) => {
        b[20] = 1;
      }),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    {
      name: 'tampered ticket id (signature kept)',
      code: mutate(v1, (b) => {
        b[18] = (b[18] as number) ^ 1;
      }),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    {
      name: 'tampered key id to another known key',
      code: mutate(v1, (b) => {
        b[2] = 2;
      }),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    {
      name: 'tampered key id to an unknown key',
      code: mutate(v1, (b) => {
        b[2] = 3;
      }),
      kids: ALL,
      expect: fail('unknown_key'),
    },
    {
      name: 'non-canonical signature (S + group order)',
      note: 'a malleable twin of a valid signature must be refused',
      code: mutate(v1, (b) => addGroupOrderToS(b, 21)),
      kids: ALL,
      expect: fail('bad_signature'),
    },
    // Versions.
    {
      name: 'unknown version 2 (correctly signed)',
      code: codeOf(payload(2, 1, T1, 0), keyOf[1] as FixedKey),
      kids: ALL,
      expect: fail('malformed'),
    },
    {
      name: 'unknown version 0 (correctly signed)',
      code: codeOf(payload(0, 1, T1, 0), keyOf[1] as FixedKey),
      kids: ALL,
      expect: fail('malformed'),
    },
    // Malformed text.
    { name: 'empty', code: '', kids: ALL, expect: fail('malformed') },
    { name: 'prefix only', code: 'YY1', kids: ALL, expect: fail('malformed') },
    { name: 'other prefix', code: `YY2${v1.slice(3)}`, kids: ALL, expect: fail('malformed') },
    { name: 'prefix in lower case', code: `yy1${v1.slice(3)}`, kids: ALL, expect: fail('malformed') },
    { name: 'a short code', code: 'ABCDEFGH', kids: ALL, expect: fail('malformed') },
    { name: 'one character short', code: v1.slice(0, -1), kids: ALL, expect: fail('malformed') },
    { name: 'two characters long', code: `${v1}AA`, kids: ALL, expect: fail('malformed') },
    {
      name: 'character outside base32',
      code: `${v1.slice(0, 20)}1${v1.slice(21)}`,
      kids: ALL,
      expect: fail('malformed'),
    },
    {
      name: 'space inside',
      code: `${v1.slice(0, 20)} ${v1.slice(20)}`,
      kids: ALL,
      expect: fail('malformed'),
    },
  ];
  return v;
}

// ── statements (detached signatures, e.g. the manifest's checkpoint scope) ───────────────────────
interface StatementVector {
  readonly name: string;
  readonly tag: string;
  readonly message: string;
  readonly signature: string;
  readonly kids: readonly number[];
  readonly expect: boolean;
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

function statement(tag: string, message: string, kid: number, key: FixedKey): Buffer {
  const sig = sign(null, Buffer.from(`yayatoh-statement:${tag}\n${message}`), key.priv);
  const head = Buffer.alloc(2);
  head.writeUInt16BE(kid);
  return Buffer.concat([head, sig]);
}

function statementVectors(): StatementVector[] {
  const TAGGED = 'checkin-scope-v1';
  const MSG = '{"eventId":"e1","deviceId":"d1","checkpointIds":["a","b"]}';
  const good = statement(TAGGED, MSG, 1, keyOf[1] as FixedKey);
  const sigOf = (b: Buffer) => b64url(b);
  const nonCanonical = Buffer.from(good);
  addGroupOrderToS(nonCanonical, 2); // kid(2) ‖ R(32) ‖ S(32): S starts 34 bytes in
  return [
    { name: 'valid', tag: TAGGED, message: MSG, signature: sigOf(good), kids: ALL, expect: true },
    {
      name: 'valid, unicode message and another tag',
      tag: 'other-tag',
      message: 'café ✓ 日本',
      signature: sigOf(statement('other-tag', 'café ✓ 日本', 2, keyOf[2] as FixedKey)),
      kids: ALL,
      expect: true,
    },
    {
      name: 'tampered message',
      tag: TAGGED,
      message: `${MSG} `,
      signature: sigOf(good),
      kids: ALL,
      expect: false,
    },
    {
      name: 'wrong tag (domain separation)',
      tag: 'other-tag',
      message: MSG,
      signature: sigOf(good),
      kids: ALL,
      expect: false,
    },
    {
      name: 'a ticket-code style tag is not a statement',
      tag: 'yayatoh-ticket-v1',
      message: MSG,
      signature: sigOf(good),
      kids: ALL,
      expect: false,
    },
    {
      name: 'unknown key id',
      tag: TAGGED,
      message: MSG,
      signature: sigOf(good),
      kids: [2, 7],
      expect: false,
    },
    {
      name: 'signed by another key under a known key id',
      tag: TAGGED,
      message: MSG,
      signature: sigOf(statement(TAGGED, MSG, 1, attacker)),
      kids: ALL,
      expect: false,
    },
    {
      name: 'key id rewritten to another known key',
      tag: TAGGED,
      message: MSG,
      signature: sigOf(Buffer.concat([Buffer.from([0, 2]), good.subarray(2)])),
      kids: ALL,
      expect: false,
    },
    {
      name: 'non-canonical signature (S + group order)',
      tag: TAGGED,
      message: MSG,
      signature: sigOf(nonCanonical),
      kids: ALL,
      expect: false,
    },
    { name: 'empty signature', tag: TAGGED, message: MSG, signature: '', kids: ALL, expect: false },
    { name: 'not base64url', tag: TAGGED, message: MSG, signature: 'not-base64!', kids: ALL, expect: false },
    {
      name: 'padded base64',
      tag: TAGGED,
      message: MSG,
      signature: `${sigOf(good)}=`,
      kids: ALL,
      expect: false,
    },
    {
      name: 'truncated',
      tag: TAGGED,
      message: MSG,
      signature: sigOf(good).slice(0, -4),
      kids: ALL,
      expect: false,
    },
  ];
}

// ── legacy QR payloads and their manifest hashes ─────────────────────────────────────────────────
const LEGACY_INPUTS: readonly (readonly [string, string, string | null])[] = [
  ['bare order number', '172633440000017', '172633440000017'],
  ['surrounding whitespace', ' 172633440000017 \n', '172633440000017'],
  ['letters keep their case', 'AbC-def_123', 'AbC-def_123'],
  ['JSON object, string order number', '{"order_number":"172633440000017","event":3}', '172633440000017'],
  ['JSON object, numeric order number', '{"order_number":172633440000017}', '172633440000017'],
  ['JSON object with whitespace around', '  {"order_number":"ab_cd-12"}  ', 'ab_cd-12'],
  ['JSON object, JSON string inside', '{"order_number":"{\\"order_number\\":\\"NESTED123\\"}"}', 'NESTED123'],
  ['JSON object without an order number', '{"id":1}', null],
  ['JSON object, null order number', '{"order_number":null}', null],
  ['JSON object, array order number', '{"order_number":["x1y2z3"]}', null],
  ['JSON object, order number too short', '{"order_number":"short"}', null],
  ['JSON object, exponent number', '{"order_number":1.5e21}', null],
  ['broken JSON', '{broken', null],
  ['five characters', 'abcde', null],
  ['six characters', 'abcdef', 'abcdef'],
  ['64 characters', 'a'.repeat(64), 'a'.repeat(64)],
  ['65 characters', 'a'.repeat(65), null],
  ['inner spaces', 'has spaces 123', null],
  ['a dot', 'abc.def.123', null],
  ['non-ASCII letters', 'ÄÖÜ12345', null],
  ['empty', '', null],
];

const HASH_INPUTS: readonly (readonly [string, string])[] = [
  ['yy-manifest:e1', '172633440000017'],
  ['yy-manifest:e1', 'AbC-def_123'],
  ['yy-manifest:e1', 'abc-def_123'],
  ['yy-manifest:e2', 'AbC-def_123'],
  ['', 'abcdef'],
  ['salt with : colons :', 'abcdef'],
  ['säl† ✓', 'abcdef'],
];

// ── plain SHA-256 and RFC 4648 base32 known answers ──────────────────────────────────────────────
const SHA256_TEXTS = [
  '',
  'abc',
  'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
  'yy-manifest:e1:ada@example.test',
  'héllo wörld ✓ 日本語',
  'a'.repeat(1000),
];

const RFC8032 = [
  {
    name: 'RFC 8032 test 1 (empty message)',
    seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    message: '',
    signature:
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    name: 'RFC 8032 test 2 (one byte)',
    seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    message: '72',
    signature:
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
];

const BASE32_RFC4648 = [
  ['', ''],
  ['f', 'MY'],
  ['fo', 'MZXQ'],
  ['foo', 'MZXW6'],
  ['foob', 'MZXW6YQ'],
  ['fooba', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI'],
] as const;

/** Every vector file: name → content. Serialised with `serialize`. */
export function buildVectors(): Record<string, unknown> {
  return {
    'ticket-codes.json': {
      description:
        'yy1 ticket codes (ADR 0011): verifyTicketCode(code, publicKeys of `kids`) must give `expect`. Codes were signed by Node OpenSSL.',
      seedRule: SEED_RULE,
      keyLabels: KEYS,
      publicKeys,
      vectors: codeVectors(),
    },
    'statements.json': {
      description:
        'Detached statement signatures: verifyStatement(tag, message, signature, publicKeys of `kids`) must give `expect`.',
      seedRule: SEED_RULE,
      publicKeys,
      vectors: statementVectors(),
    },
    'legacy.json': {
      description:
        'Legacy (Eventmie) QR payloads: legacyQrPayload(input) must give `payload`; legacyPayloadHash(salt, payload) must give `hash` (SHA-256 of "legacy:" + salt + ":" + payload, hex, by OpenSSL).',
      payloads: LEGACY_INPUTS.map(([name, input, payloadOut]) => ({ name, input, payload: payloadOut })),
      hashes: HASH_INPUTS.map(([salt, p]) => ({
        salt,
        payload: p,
        hash: createHash('sha256').update(`legacy:${salt}:${p}`).digest('hex'),
      })),
    },
    'primitives.json': {
      description:
        'Known answers for the primitives: SHA-256 (FIPS 180 examples and OpenSSL), Ed25519 (RFC 8032) and RFC 4648 base32 without padding.',
      sha256: SHA256_TEXTS.map((text) => ({ text, hex: createHash('sha256').update(text).digest('hex') })),
      ed25519: RFC8032,
      base32: BASE32_RFC4648.map(([text, encoded]) => ({ text, encoded })),
    },
  };
}

export const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
