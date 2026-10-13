import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * The only cryptography the universal door code uses (M7.1a): pure-JavaScript Ed25519 and SHA-256
 * from audited `@noble` packages, so the same bytes give the same verdict in browsers, Node and
 * Hermes (React Native has no `crypto.subtle`). `check:modules` keeps `crypto.subtle` out of
 * universal packages. Ed25519 is deterministic, so signatures are byte-identical to Web Crypto's.
 */

/** PKCS#8 DER prefix of an Ed25519 private key; the 32-byte seed follows (RFC 8410). */
const PKCS8_PREFIX = Uint8Array.of(
  0x30,
  0x2e,
  0x02,
  0x01,
  0x00,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x70,
  0x04,
  0x22,
  0x04,
  0x20,
);
const PKCS8_LEN = PKCS8_PREFIX.length + 32;

/** The seed inside an Ed25519 PKCS#8 key. Throws on any other key (as Web Crypto's import did). */
function seedOf(pkcs8: Uint8Array): Uint8Array {
  if (pkcs8.length !== PKCS8_LEN || PKCS8_PREFIX.some((b, i) => pkcs8[i] !== b))
    throw new Error('not an Ed25519 PKCS#8 private key');
  return pkcs8.slice(PKCS8_PREFIX.length);
}

/** A fresh key pair: the 32-byte raw public key and the PKCS#8 private key the vault stores. */
export function ed25519KeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const { secretKey, publicKey } = ed25519.keygen();
  const privateKey = new Uint8Array(PKCS8_LEN);
  privateKey.set(PKCS8_PREFIX);
  privateKey.set(secretKey, PKCS8_PREFIX.length);
  return { publicKey, privateKey };
}

/** The PKCS#8 private key for a fixed 32-byte seed (the test-vector generator's fixed keys). */
export function ed25519KeyPairFromSeed(seed: Uint8Array): { publicKey: Uint8Array; privateKey: Uint8Array } {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  const privateKey = new Uint8Array(PKCS8_LEN);
  privateKey.set(PKCS8_PREFIX);
  privateKey.set(seed, PKCS8_PREFIX.length);
  return { publicKey: ed25519.getPublicKey(seed), privateKey };
}

/** Sign with a PKCS#8 private key. Throws on a malformed key. */
export function ed25519Sign(message: Uint8Array, privateKeyPkcs8: Uint8Array): Uint8Array {
  return ed25519.sign(message, seedOf(privateKeyPkcs8));
}

/**
 * Verify with a raw 32-byte public key. Never throws: a wrong-length key or signature is `false`.
 * Strict RFC 8032 checking (no ZIP-215 leniency), so non-canonical encodings are refused, as the
 * Web Crypto verifier this replaces did.
 */
export function ed25519Verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

/** SHA-256 of the UTF-8 text, as lowercase hex. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}
