/**
 * Pure rules of networking chat (M5.8b, P5-3): message limits, text normalization, the pair key of
 * a direct conversation and retention. No I/O.
 */

/** A message is at most this long (characters, after normalization). */
export const CHAT_MESSAGE_MAX = 2000;
/** Messages one sender may send per minute and per hour, across all their conversations. */
export const CHAT_PER_MINUTE = 10;
export const CHAT_PER_HOUR = 120;
/** Conversations one attendee may start per hour (a first message to someone new). */
export const NEW_CHATS_PER_HOUR = 20;
/** Messages in a row without an answer, after which the sender waits for a reply. */
export const UNANSWERED_LIMIT = 5;
/** An exhibitor's booth answers more people at once: its limit per minute (all its staff). */
export const BOOTH_PER_MINUTE = 30;
/** Messages a conversation page loads (the latest). */
export const CHAT_PAGE = 200;
/** How much of a conversation a report shows its reviewers: the latest messages, clipped. */
export const EXCERPT_MESSAGES = 10;
export const EXCERPT_CHARS = 280;
/** D11: attendee personal data is kept 24 months; chats go 24 months after their event ends. */
export const CHAT_RETENTION_MONTHS = 24;

export type ChatRefusal = 'too_fast' | 'hourly_limit' | 'too_many_new_chats' | 'awaiting_reply';

export interface ChatRate {
  /** Messages this sender sent in the last minute and hour. */
  readonly lastMinute: number;
  readonly lastHour: number;
  /** Conversations this sender started in the last hour. */
  readonly newChatsLastHour: number;
  /** This message starts a conversation. */
  readonly startsChat: boolean;
  /** This sender's messages at the end of the conversation since the other side last wrote. */
  readonly unanswered: number;
  /** The per-minute limit (an exhibitor's booth has a larger one). */
  readonly perMinute?: number;
}

/** Why a message may not be sent now, or null. The limit that clears soonest is named first. */
export function chatRefusal(r: ChatRate): ChatRefusal | null {
  if (r.lastMinute >= (r.perMinute ?? CHAT_PER_MINUTE)) return 'too_fast';
  if (r.lastHour >= CHAT_PER_HOUR) return 'hourly_limit';
  if (r.startsChat && r.newChatsLastHour >= NEW_CHATS_PER_HOUR) return 'too_many_new_chats';
  if (r.unanswered >= UNANSWERED_LIMIT) return 'awaiting_reply';
  return null;
}

// C0 and C1 controls except tab and line feed, and the bidirectional overrides and isolates
// (they can disguise what a message says).
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/** A message as stored: line breaks unified, controls dropped, trimmed, at most one blank line. */
export function normalizeChatBody(text: string): string | null {
  const s = text
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s === '' ? null : s;
}

/** A direct conversation's two profiles, lowest id first (one conversation per pair). */
export function directPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Events that ended before this moment have their chats deleted (calendar months, clamped). */
export function chatRetentionCutoff(now: Date): Date {
  const d = new Date(now);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - CHAT_RETENTION_MONTHS);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** A message as a report excerpt shows it. */
export const clipExcerpt = (s: string) => (s.length > EXCERPT_CHARS ? `${s.slice(0, EXCERPT_CHARS - 1)}…` : s);
