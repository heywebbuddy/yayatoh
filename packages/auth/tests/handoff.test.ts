import { describe, expect, it } from 'vitest';
import {
  HANDOFF_TTL_MS,
  handoffExpired,
  hashHandoffCode,
  isHandoffCode,
  newHandoffCode,
  normalizeHandoffHost,
  safeReturnPath,
  stateMatches,
} from '../src/handoff.ts';
import { impersonationReason, isImpersonationActive } from '../src/impersonation.ts';

describe('handoff codes (M1.2d)', () => {
  it('are 256 random bits in base64url, never the same twice', () => {
    const codes = new Set(Array.from({ length: 200 }, newHandoffCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(isHandoffCode(c)).toBe(true);
    expect(isHandoffCode('short')).toBe(false);
    expect(isHandoffCode(`${newHandoffCode()}=`)).toBe(false);
  });

  it('are stored as SHA-256 hex only: stable, and unrelated to the code text', () => {
    const code = newHandoffCode();
    const hash = hashHandoffCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashHandoffCode(code)).toBe(hash);
    expect(hash).not.toContain(code);
    expect(hashHandoffCode(newHandoffCode())).not.toBe(hash);
    // A known vector, so the stored format never changes by accident.
    expect(hashHandoffCode('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('expire after exactly 60 seconds', () => {
    const issued = new Date('2026-09-28T10:00:00Z');
    const expiresAt = new Date(issued.getTime() + HANDOFF_TTL_MS);
    expect(HANDOFF_TTL_MS).toBe(60_000);
    expect(handoffExpired(expiresAt, new Date(issued.getTime() + 59_999))).toBe(false);
    expect(handoffExpired(expiresAt, expiresAt)).toBe(true);
    expect(handoffExpired(expiresAt, new Date(issued.getTime() + 61_000))).toBe(true);
  });

  it('bind to a normalized host (port kept outside production)', () => {
    expect(normalizeHandoffHost('Harbor-Arts.Yayatoh.Events')).toBe('harbor-arts.yayatoh.events');
    expect(normalizeHandoffHost('tickets.example.com.')).toBe('tickets.example.com');
    expect(normalizeHandoffHost('harbor-arts.yayatoh.events:3100')).toBe('harbor-arts.yayatoh.events:3100');
    expect(normalizeHandoffHost('evil.com/path')).toBeNull();
    expect(normalizeHandoffHost('user@evil.com')).toBeNull();
    expect(normalizeHandoffHost('')).toBeNull();
    expect(normalizeHandoffHost(null)).toBeNull();
  });

  it('land only on a path of the same host', () => {
    expect(safeReturnPath('/events/gala?x=1')).toBe('/events/gala?x=1');
    expect(safeReturnPath('//evil.com')).toBe('/');
    expect(safeReturnPath('https://evil.com')).toBe('/');
    expect(safeReturnPath('/\\evil.com')).toBe('/');
    expect(safeReturnPath('/a\nb')).toBe('/');
    expect(safeReturnPath(undefined)).toBe('/');
  });

  it('check the browser state cookie in constant time', () => {
    const state = newHandoffCode();
    const hash = hashHandoffCode(state);
    expect(stateMatches(state, hash)).toBe(true);
    expect(stateMatches(newHandoffCode(), hash)).toBe(false);
    expect(stateMatches(null, hash)).toBe(false);
    expect(stateMatches('x', hash)).toBe(false);
  });
});

describe('impersonation rules (M1.2e)', () => {
  it('needs a reason (trimmed, at most 500 characters)', () => {
    expect(impersonationReason('  Ticket #4312:   refund question ')).toBe('Ticket #4312: refund question');
    expect(impersonationReason('   ')).toBeNull();
    expect(impersonationReason(undefined)).toBeNull();
    expect(impersonationReason('x'.repeat(501))).toBeNull();
  });

  it('is active until ended or its hour passes', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    const later = new Date(now.getTime() + 60_000);
    expect(isImpersonationActive({ endedAt: null, expiresAt: later }, now)).toBe(true);
    expect(isImpersonationActive({ endedAt: now, expiresAt: later }, now)).toBe(false);
    expect(isImpersonationActive({ endedAt: null, expiresAt: now }, now)).toBe(false);
  });
});
