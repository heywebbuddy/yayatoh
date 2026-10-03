import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_MAX,
  CHAT_PER_HOUR,
  CHAT_PER_MINUTE,
  CHAT_RETENTION_MONTHS,
  chatRefusal,
  chatRetentionCutoff,
  clipExcerpt,
  directPair,
  EXCERPT_CHARS,
  NEW_CHATS_PER_HOUR,
  normalizeChatBody,
  UNANSWERED_LIMIT,
} from '../src/domain/chat.ts';

const quiet = { lastMinute: 0, lastHour: 0, newChatsLastHour: 0, startsChat: false, unanswered: 0 };

describe('chatRefusal (rate limits, P5-3)', () => {
  it('lets an ordinary message through', () => {
    expect(chatRefusal(quiet)).toBeNull();
    expect(chatRefusal({ ...quiet, lastMinute: CHAT_PER_MINUTE - 1, lastHour: CHAT_PER_HOUR - 1 })).toBeNull();
  });
  it('refuses a burst within a minute, then within an hour', () => {
    expect(chatRefusal({ ...quiet, lastMinute: CHAT_PER_MINUTE })).toBe('too_fast');
    expect(chatRefusal({ ...quiet, lastHour: CHAT_PER_HOUR })).toBe('hourly_limit');
    // The minute limit is the one to tell first (it clears soonest).
    expect(chatRefusal({ ...quiet, lastMinute: CHAT_PER_MINUTE, lastHour: CHAT_PER_HOUR })).toBe('too_fast');
  });
  it('limits new conversations per hour, but not replies in existing ones', () => {
    expect(chatRefusal({ ...quiet, newChatsLastHour: NEW_CHATS_PER_HOUR, startsChat: true })).toBe(
      'too_many_new_chats',
    );
    expect(chatRefusal({ ...quiet, newChatsLastHour: NEW_CHATS_PER_HOUR, startsChat: false })).toBeNull();
    expect(chatRefusal({ ...quiet, newChatsLastHour: NEW_CHATS_PER_HOUR - 1, startsChat: true })).toBeNull();
  });
  it('waits for a reply after a run of unanswered messages', () => {
    expect(chatRefusal({ ...quiet, unanswered: UNANSWERED_LIMIT - 1 })).toBeNull();
    expect(chatRefusal({ ...quiet, unanswered: UNANSWERED_LIMIT })).toBe('awaiting_reply');
  });
  it('limits stay sane', () => {
    expect(CHAT_PER_MINUTE).toBeLessThan(CHAT_PER_HOUR);
    expect(UNANSWERED_LIMIT).toBeGreaterThan(1);
  });
});

describe('normalizeChatBody', () => {
  it('trims, keeps line breaks, folds long runs of blank lines', () => {
    expect(normalizeChatBody('  Hi there  ')).toBe('Hi there');
    expect(normalizeChatBody('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeChatBody('a\r\nb')).toBe('a\nb');
  });
  it('drops control characters (but keeps tabs and line breaks)', () => {
    expect(normalizeChatBody('a\u0000b\u0007c\td')).toBe('abc\td');
    expect(normalizeChatBody('x‮y')).toBe('xy');
  });
  it('is null when nothing is left, and refuses nothing by length (the command does)', () => {
    expect(normalizeChatBody('   \n\n ')).toBeNull();
    expect(normalizeChatBody('\u0000')).toBeNull();
    expect(normalizeChatBody('x'.repeat(CHAT_MESSAGE_MAX + 5))?.length).toBe(CHAT_MESSAGE_MAX + 5);
  });
});

describe('directPair', () => {
  it('orders two profile ids the same way whoever starts', () => {
    const a = '0190a000-0000-7000-8000-00000000000a';
    const b = '0190b000-0000-7000-8000-00000000000b';
    expect(directPair(a, b)).toEqual([a, b]);
    expect(directPair(b, a)).toEqual([a, b]);
  });
});

describe('chat retention (D11: 24 months after the event)', () => {
  it('cuts off 24 calendar months back', () => {
    expect(CHAT_RETENTION_MONTHS).toBe(24);
    expect(chatRetentionCutoff(new Date('2026-10-03T12:00:00Z')).toISOString()).toBe('2024-10-03T12:00:00.000Z');
    // Month ends clamp instead of rolling over (29 Feb has no twin two years back).
    expect(chatRetentionCutoff(new Date('2028-02-29T00:00:00Z')).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});

describe('clipExcerpt', () => {
  it('cuts long messages with an ellipsis', () => {
    expect(clipExcerpt('short')).toBe('short');
    const long = clipExcerpt('y'.repeat(EXCERPT_CHARS + 50));
    expect(long).toHaveLength(EXCERPT_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });
});
