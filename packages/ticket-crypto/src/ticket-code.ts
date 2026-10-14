import { base32Decode, base32Encode } from './base32.ts';
import { ed25519KeyPair, ed25519Sign, ed25519Verify } from './primitives.ts';

/**
 * yy1 ticket code (ADR 0011): "YY1" + base32(payload ‖ Ed25519 signature).
 * payload = version(1) ‖ kid(2, BE) ‖ ticket id(16, UUID bytes) ‖ rev(2, BE)  — 21 bytes.
 * The signature covers a domain-separation tag plus the payload. 85 bytes → 136 base32 chars (139 with
 * the prefix), which fits a V7-M QR in alphanumeric mode (178). Offline scanners need only the public key.
 */
export const CODE_PREFIX = 'YY1';
const VERSION = 1;
const PAYLOAD_LEN = 21;
const SIG_LEN = 64;
const TAG = new TextEncoder().encode('yayatoh-ticket-v1');

export interface TicketClaims {
  readonly kid: number;
  readonly ticketId: string;
  readonly rev: number;
}

export type VerifyResult =
  | ({ readonly ok: true } & TicketClaims)
  | { readonly ok: false; readonly reason: 'malformed' | 'unknown_key' | 'bad_signature' };

function uuidToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('ticket id must be a UUID');
  return Uint8Array.from(hex.match(/../g) as string[], (h) => Number.parseInt(h, 16));
}

function bytesToUuid(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function payload(c: TicketClaims): Uint8Array {
  if (!Number.isInteger(c.kid) || c.kid < 0 || c.kid > 0xffff) throw new Error('kid must be 0..65535');
  if (!Number.isInteger(c.rev) || c.rev < 0 || c.rev > 0xffff) throw new Error('rev must be 0..65535');
  const p = new Uint8Array(PAYLOAD_LEN);
  p[0] = VERSION;
  p[1] = c.kid >> 8;
  p[2] = c.kid & 255;
  p.set(uuidToBytes(c.ticketId), 3);
  p[19] = c.rev >> 8;
  p[20] = c.rev & 255;
  return p;
}

const signed = (p: Uint8Array) => {
  const m = new Uint8Array(TAG.length + p.length);
  m.set(TAG);
  m.set(p, TAG.length);
  return m;
};

export interface KeyPair {
  /** 32-byte raw public key (distributed to scanners in the manifest header). */
  readonly publicKey: Uint8Array;
  /** PKCS#8 private key (store encrypted; never leaves the server). */
  readonly privateKey: Uint8Array;
}

export async function generateKeyPair(): Promise<KeyPair> {
  return ed25519KeyPair();
}

export async function signTicketCode(claims: TicketClaims, privateKeyPkcs8: Uint8Array): Promise<string> {
  const p = payload(claims);
  const sig = ed25519Sign(signed(p), privateKeyPkcs8);
  const all = new Uint8Array(PAYLOAD_LEN + SIG_LEN);
  all.set(p);
  all.set(sig, PAYLOAD_LEN);
  return CODE_PREFIX + base32Encode(all);
}

/** Verify with public keys only (offline-capable). Never throws on bad input. */
export async function verifyTicketCode(
  code: string,
  publicKeys: ReadonlyMap<number, Uint8Array>,
): Promise<VerifyResult> {
  if (!code.startsWith(CODE_PREFIX)) return { ok: false, reason: 'malformed' };
  const bytes = base32Decode(code.slice(CODE_PREFIX.length).trim().toUpperCase());
  if (!bytes || bytes.length !== PAYLOAD_LEN + SIG_LEN || bytes[0] !== VERSION)
    return { ok: false, reason: 'malformed' };
  const p = bytes.slice(0, PAYLOAD_LEN);
  const kid = ((p[1] as number) << 8) | (p[2] as number);
  const raw = publicKeys.get(kid);
  if (!raw) return { ok: false, reason: 'unknown_key' };
  if (!ed25519Verify(bytes.slice(PAYLOAD_LEN), signed(p), raw)) return { ok: false, reason: 'bad_signature' };
  return {
    ok: true,
    kid,
    ticketId: bytesToUuid(p.slice(3, 19)),
    rev: ((p[19] as number) << 8) | (p[20] as number),
  };
}

/** Human-typeable short code (Crockford-style, no ambiguous characters). */
export function randomShortCode(length = 8): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  const r = new Uint8Array(length);
  globalThis.crypto.getRandomValues(r);
  return [...r].map((x) => alphabet[x % alphabet.length]).join('');
}

/**
 * A detached Ed25519 signature over a tagged message, with the org's ticket key. Used for small
 * statements scanners must trust offline (the checkpoint scope in a manifest). The tag separates
 * domains, so a statement signature can never pass as a ticket code and vice versa.
 * Format: base64url(kid(2, BE) ‖ signature(64)).
 */
export async function signStatement(
  tag: string,
  message: string,
  kid: number,
  privateKeyPkcs8: Uint8Array,
): Promise<string> {
  if (!Number.isInteger(kid) || kid < 0 || kid > 0xffff) throw new Error('kid must be 0..65535');
  const sig = ed25519Sign(statementBytes(tag, message), privateKeyPkcs8);
  const all = new Uint8Array(2 + SIG_LEN);
  all[0] = kid >> 8;
  all[1] = kid & 255;
  all.set(sig, 2);
  return toBase64Url(all);
}

/** Verify a statement signature with public keys only. Never throws on bad input. */
export async function verifyStatement(
  tag: string,
  message: string,
  signature: string,
  publicKeys: ReadonlyMap<number, Uint8Array>,
): Promise<boolean> {
  const bytes = fromBase64Url(signature);
  if (!bytes || bytes.length !== 2 + SIG_LEN) return false;
  const raw = publicKeys.get(((bytes[0] as number) << 8) | (bytes[1] as number));
  if (!raw) return false;
  return ed25519Verify(bytes.slice(2), statementBytes(tag, message), raw);
}

const statementBytes = (tag: string, message: string) =>
  new TextEncoder().encode(`yayatoh-statement:${tag}\n${message}`);

function toBase64Url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
