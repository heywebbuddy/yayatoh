import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateKeyPair,
  legacyPayloadHash,
  legacyQrPayload,
  sha256Hex,
  signStatement,
  signTicketCode,
  verifyStatement,
  verifyTicketCode,
} from '../src/index.ts';
import { ed25519Sign, ed25519Verify } from '../src/primitives.ts';
import { buildVectors, serialize } from './generate-vectors.ts';

const dir = fileURLToPath(new URL('../vectors/', import.meta.url));
const read = <T>(name: string) => JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as T;
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const hex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const privateKeyOf = (label: string) =>
  new Uint8Array(
    Buffer.concat([PKCS8_PREFIX, createHash('sha256').update(`yayatoh-test-vector-key:${label}`).digest()]),
  );

function keySet(all: Record<string, string>, kids: readonly number[]): Map<number, Uint8Array> {
  return new Map(kids.map((kid) => [kid, fromB64(all[String(kid)] as string)]));
}

interface CodeFile {
  keyLabels: Record<string, string>;
  publicKeys: Record<string, string>;
  vectors: {
    name: string;
    code: string;
    kids: number[];
    expect: { ok: boolean; kid?: number; ticketId?: string; rev?: number; reason?: string };
  }[];
}

describe('the committed vector files', () => {
  it('are exactly what the generator produces (they can never change silently)', () => {
    const built = buildVectors();
    expect(readdirSync(dir).sort()).toEqual(Object.keys(built).sort());
    for (const [name, value] of Object.entries(built)) {
      expect(readFileSync(`${dir}${name}`, 'utf8'), name).toBe(serialize(value));
    }
  });
});

describe('ticket code vectors (verify)', () => {
  const file = read<CodeFile>('ticket-codes.json');

  it('cover valid codes for several keys and every refusal', () => {
    const reasons = new Set(file.vectors.map((v) => v.expect.reason));
    expect(reasons).toEqual(new Set([undefined, 'unknown_key', 'bad_signature', 'malformed']));
    expect(new Set(file.vectors.filter((v) => v.expect.ok).map((v) => v.expect.kid))).toEqual(
      new Set([1, 2, 7, 65535]),
    );
  });

  for (const v of file.vectors) {
    it(v.name, async () => {
      const result = await verifyTicketCode(v.code, keySet(file.publicKeys, v.kids));
      expect(result).toEqual(v.expect);
    });
  }
});

describe('ticket code vectors (sign)', () => {
  const file = read<CodeFile>('ticket-codes.json');

  it('signing with the pure-JavaScript Ed25519 reproduces OpenSSL’s codes byte for byte', async () => {
    let n = 0;
    for (const v of file.vectors) {
      if (!v.expect.ok || !/^YY1[A-Z2-7]{136}$/.test(v.code)) continue;
      const label = file.keyLabels[String(v.expect.kid)] as string;
      const code = await signTicketCode(
        { kid: v.expect.kid as number, ticketId: v.expect.ticketId as string, rev: v.expect.rev as number },
        privateKeyOf(label),
      );
      expect(code, v.name).toBe(v.code);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(8);
  });
});

describe('statement vectors', () => {
  const file = read<{
    publicKeys: Record<string, string>;
    vectors: {
      name: string;
      tag: string;
      message: string;
      signature: string;
      kids: number[];
      expect: boolean;
    }[];
  }>('statements.json');

  for (const v of file.vectors) {
    it(v.name, async () => {
      expect(await verifyStatement(v.tag, v.message, v.signature, keySet(file.publicKeys, v.kids))).toBe(
        v.expect,
      );
    });
  }

  it('signing reproduces OpenSSL’s signature byte for byte', async () => {
    const valid = file.vectors.find((v) => v.name === 'valid') as (typeof file.vectors)[number];
    expect(await signStatement(valid.tag, valid.message, 1, privateKeyOf('org-a'))).toBe(valid.signature);
    const other = file.vectors.find((v) =>
      v.name.startsWith('valid, unicode'),
    ) as (typeof file.vectors)[number];
    expect(await signStatement(other.tag, other.message, 2, privateKeyOf('org-a-rotated'))).toBe(
      other.signature,
    );
  });
});

describe('legacy payload vectors', () => {
  const file = read<{
    payloads: { name: string; input: string; payload: string | null }[];
    hashes: { salt: string; payload: string; hash: string }[];
  }>('legacy.json');

  it('extract the order number from every form', () => {
    expect(file.payloads.length).toBeGreaterThan(15);
    for (const p of file.payloads) expect(legacyQrPayload(p.input), p.name).toBe(p.payload);
  });

  it('hash per event salt, case-sensitively and domain separated', async () => {
    for (const h of file.hashes) expect(await legacyPayloadHash(h.salt, h.payload)).toBe(h.hash);
    // Same payload under another case or another salt hashes differently.
    expect(new Set(file.hashes.slice(1, 4).map((h) => h.hash)).size).toBe(3);
  });
});

describe('primitive known answers', () => {
  const file = read<{
    sha256: { text: string; hex: string }[];
    ed25519: { name: string; seed: string; publicKey: string; message: string; signature: string }[];
    base32: { text: string; encoded: string }[];
  }>('primitives.json');

  it('SHA-256 matches FIPS 180 and OpenSSL', () => {
    expect(file.sha256[1]?.hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const s of file.sha256) expect(sha256Hex(s.text), s.text.slice(0, 20)).toBe(s.hex);
  });

  it('Ed25519 matches RFC 8032 (sign and verify)', () => {
    for (const t of file.ed25519) {
      const priv = new Uint8Array(Buffer.concat([PKCS8_PREFIX, Buffer.from(t.seed, 'hex')]));
      expect(Buffer.from(ed25519Sign(hex(t.message), priv)).toString('hex'), t.name).toBe(t.signature);
      expect(ed25519Verify(hex(t.signature), hex(t.message), hex(t.publicKey)), t.name).toBe(true);
      expect(ed25519Verify(hex(t.signature), hex(`${t.message}00`), hex(t.publicKey)), t.name).toBe(false);
    }
  });

  it('base32 matches RFC 4648 without padding', () => {
    for (const t of file.base32) {
      const bytes = new TextEncoder().encode(t.text);
      expect(base32Encode(bytes)).toBe(t.encoded);
      expect(base32Decode(t.encoded)).toEqual(bytes);
    }
  });
});

describe('agreement with Web Crypto (Node), the implementation this replaced', () => {
  const subtle = globalThis.crypto.subtle;
  // A fixed pseudo-random stream, so the checks are the same on every run.
  let state = 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => next() & 255);

  it('keys from Web Crypto (as the vault stores them) sign identically and verify both ways', async () => {
    for (let i = 0; i < 25; i++) {
      const kp = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
      const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
      const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
      const msg = bytes(i * 7);
      const theirs = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, kp.privateKey, msg));
      expect(ed25519Sign(msg, pkcs8)).toEqual(theirs);
      expect(ed25519Verify(theirs, msg, raw)).toBe(true);
    }
  });

  it('keys generated here import into Web Crypto and agree on signatures', async () => {
    for (let i = 0; i < 10; i++) {
      const kp = await generateKeyPair();
      expect(kp.publicKey).toHaveLength(32);
      expect(kp.privateKey).toHaveLength(48);
      const priv = await subtle.importKey(
        'pkcs8',
        new Uint8Array(kp.privateKey),
        { name: 'Ed25519' },
        false,
        ['sign'],
      );
      const pub = await subtle.importKey('raw', new Uint8Array(kp.publicKey), { name: 'Ed25519' }, false, [
        'verify',
      ]);
      const msg = bytes(33);
      const sig = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, priv, msg));
      expect(ed25519Verify(sig, msg, kp.publicKey)).toBe(true);
      expect(
        await subtle.verify({ name: 'Ed25519' }, pub, new Uint8Array(ed25519Sign(msg, kp.privateKey)), msg),
      ).toBe(true);
    }
  });

  it('gives the same accept/refuse answer on tampered signatures, messages and keys', async () => {
    const kp = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    const msg = bytes(40);
    const sig = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, kp.privateKey, msg));
    let refused = 0;
    for (let i = 0; i < 400; i++) {
      const s = new Uint8Array(sig);
      const m = new Uint8Array(msg);
      const k = new Uint8Array(raw);
      const target = next() % 3;
      const bit = 1 << (next() % 8);
      if (target === 0) s[next() % 64] = (s[next() % 64] as number) ^ bit;
      else if (target === 1) m[next() % m.length] = (m[next() % m.length] as number) ^ bit;
      else k[next() % 32] = (k[next() % 32] as number) ^ bit;
      const theirs = await subtle
        .importKey('raw', k, { name: 'Ed25519' }, false, ['verify'])
        .then((key) => subtle.verify({ name: 'Ed25519' }, key, s, m))
        .catch(() => false);
      const ours = ed25519Verify(s, m, k);
      expect(ours, `case ${i}`).toBe(theirs);
      if (!ours) refused++;
    }
    expect(refused).toBeGreaterThan(300);
  });
});

describe('bad input never throws on the verify side', () => {
  it('a public key of the wrong length is a refusal, not an exception', async () => {
    const kp = await generateKeyPair();
    const code = await signTicketCode(
      { kid: 1, ticketId: '0192f000-0000-7000-8000-000000000001', rev: 0 },
      kp.privateKey,
    );
    expect(await verifyTicketCode(code, new Map([[1, new Uint8Array(31)]]))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(await verifyTicketCode(code, new Map([[1, new Uint8Array(0)]]))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(await verifyStatement('t', 'm', 'AAEA', new Map([[1, new Uint8Array(5)]]))).toBe(false);
  });

  it('signing with something that is not an Ed25519 PKCS#8 key throws', async () => {
    const claims = { kid: 1, ticketId: '0192f000-0000-7000-8000-000000000001', rev: 0 };
    await expect(signTicketCode(claims, new Uint8Array(48))).rejects.toThrow();
    await expect(signTicketCode(claims, new Uint8Array(32))).rejects.toThrow();
    await expect(signStatement('t', 'm', 1, new Uint8Array(10))).rejects.toThrow();
  });
});
