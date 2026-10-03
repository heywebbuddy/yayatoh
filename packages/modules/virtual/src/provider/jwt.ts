import { createHmac, createSign, createVerify, type KeyObject, timingSafeEqual } from 'node:crypto';
import type { PlaybackClaims } from './port.ts';

/**
 * Compact JWTs for playback tokens: HS256 (the fake) or RS256 (Mux signing keys). Only what the
 * port needs: a fixed header, Mux's claims (`sub` = playback id, `aud` = `v`, `exp`) and ours
 * under `yy`. Verification checks the algorithm, the key id, the signature and the expiry.
 */
const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAYBACK_ID = /^[A-Za-z0-9_]{8,64}$/;
/** Longest token we parse (a 4096-bit RS256 signature is 683 characters). */
export const MAX_TOKEN_LENGTH = 1500;

export type Signer =
  | { readonly alg: 'HS256'; readonly kid: string; readonly secret: string }
  | {
      readonly alg: 'RS256';
      readonly kid: string;
      readonly privateKey: KeyObject;
      readonly publicKey: KeyObject;
    };

function signature(s: Signer, input: string): string {
  if (s.alg === 'HS256') return createHmac('sha256', s.secret).update(input).digest('base64url');
  return createSign('RSA-SHA256').update(input).sign(s.privateKey).toString('base64url');
}

export function signJwt(s: Signer, c: PlaybackClaims): string {
  const header = b64(JSON.stringify({ alg: s.alg, typ: 'JWT', kid: s.kid }));
  const payload = b64(
    JSON.stringify({
      sub: c.playbackId,
      aud: 'v',
      exp: Math.floor(c.expiresAt.getTime() / 1000),
      kid: s.kid,
      yy: { org: c.orgId, vid: c.viewId },
    }),
  );
  const input = `${header}.${payload}`;
  return `${input}.${signature(s, input)}`;
}

function parse(part: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function authentic(s: Signer, input: string, sig: string): boolean {
  if (s.alg === 'HS256') {
    const a = Buffer.from(sig);
    const b = Buffer.from(signature(s, input));
    return a.length === b.length && timingSafeEqual(a, b);
  }
  try {
    return createVerify('RSA-SHA256').update(input).verify(s.publicKey, Buffer.from(sig, 'base64url'));
  } catch {
    return false;
  }
}

/** The claims of an authentic token signed by `s` that has not expired at `now`, else null. */
export function verifyJwt(s: Signer, token: string, now: Date): PlaybackClaims | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h = '', p = '', sig = ''] = parts;
  const header = parse(h);
  if (!header || header.alg !== s.alg || header.kid !== s.kid) return null;
  if (!authentic(s, `${h}.${p}`, sig)) return null;
  const body = parse(p);
  if (body?.aud !== 'v' || typeof body.exp !== 'number' || typeof body.sub !== 'string') return null;
  const yy = body.yy as { org?: unknown; vid?: unknown } | undefined;
  if (!yy || typeof yy.org !== 'string' || typeof yy.vid !== 'string') return null;
  if (!PLAYBACK_ID.test(body.sub) || !UUID.test(yy.org) || !UUID.test(yy.vid)) return null;
  if (body.exp * 1000 <= now.getTime()) return null;
  return { playbackId: body.sub, orgId: yy.org, viewId: yy.vid, expiresAt: new Date(body.exp * 1000) };
}
