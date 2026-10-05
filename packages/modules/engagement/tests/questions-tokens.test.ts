import { describe, expect, it } from 'vitest';
import { moderate, publicOrder } from '../src/domain/questions.ts';
import {
  PARTICIPANT_KEY,
  participantKey,
  signDisplayToken,
  verifyDisplayToken,
} from '../src/domain/tokens.ts';

const ORG = '0190a000-0000-7000-8000-00000000000a';
const S = '01905000-0000-7000-8000-000000000005';
const SECRET = 'x'.repeat(40);

describe('moderation (M5.7a)', () => {
  it('approve, dismiss, answer and back; impossible moves are refused', () => {
    const pending = { state: 'pending' as const, answered: false };
    const approved = moderate(pending, 'approve');
    expect(approved).toEqual({ state: 'approved', answered: false });
    expect(moderate(pending, 'answer')).toBeNull();
    expect(approved && moderate(approved, 'approve')).toBeNull();
    const answered = approved && moderate(approved, 'answer');
    expect(answered).toEqual({ state: 'approved', answered: true });
    expect(answered && moderate(answered, 'unanswer')).toEqual({ state: 'approved', answered: false });
    expect(answered && moderate(answered, 'dismiss')).toEqual({ state: 'dismissed', answered: false });
    expect(moderate({ state: 'dismissed', answered: false }, 'approve')).toEqual({
      state: 'approved',
      answered: false,
    });
  });

  it('the audience order: pinned, unanswered, most upvoted, oldest', () => {
    const q = (id: string, upvotes: number, answered = false, createdAt = '2030-01-01T00:00:00.000Z') => ({
      id,
      upvotes,
      answered,
      createdAt,
    });
    const list = [
      q('a', 1),
      q('b', 5, true),
      q('c', 3),
      q('d', 3, false, '2029-01-01T00:00:00.000Z'),
      q('e', 0),
    ];
    expect(publicOrder(list).map((x) => x.id)).toEqual(['d', 'c', 'a', 'e', 'b']);
    expect(publicOrder(list, 'e').map((x) => x.id)).toEqual(['e', 'd', 'c', 'a', 'b']);
  });
});

describe('signed big-screen links and participant keys', () => {
  it('a display token round-trips and refuses tampering', () => {
    const t = signDisplayToken({ orgId: ORG, sessionId: S, version: 3 }, SECRET);
    expect(t).not.toContain('.');
    expect(verifyDisplayToken(t, SECRET)).toEqual({ orgId: ORG, sessionId: S, version: 3 });
    expect(verifyDisplayToken(t, 'y'.repeat(40))).toBeNull();
    expect(verifyDisplayToken(t.replace('~3~', '~4~'), SECRET)).toBeNull();
    const other = '0190b000-0000-7000-8000-00000000000b';
    expect(verifyDisplayToken(t.replace(ORG, other), SECRET)).toBeNull();
    for (const bad of ['', 'abc', `${ORG}~${S}~0~x`, `${ORG}~${S}~1`, `${t}~x`])
      expect(verifyDisplayToken(bad, SECRET)).toBeNull();
  });

  it('participant keys are per session and say nothing by themselves', () => {
    const k = participantKey(SECRET, S, 'user:1');
    expect(k).toMatch(PARTICIPANT_KEY);
    expect(participantKey(SECRET, S, 'user:1')).toBe(k);
    expect(participantKey(SECRET, ORG, 'user:1')).not.toBe(k);
    expect(participantKey(SECRET, S, 'user:2')).not.toBe(k);
    expect(k).not.toContain('user');
  });
});
