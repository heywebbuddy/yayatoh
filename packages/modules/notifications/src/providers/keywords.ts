import type { Keyword } from './types.ts';

/**
 * Text keywords (M3.5b). Opt-out words follow the FCC's 2024 revocation order (47 CFR
 * § 64.1200(a)(10)): STOP, QUIT, END, REVOKE, OPT OUT, CANCEL, UNSUBSCRIBE, plus the carriers'
 * STOPALL; START/UNSTOP resume; HELP/INFO ask for help. A reply counts when it is the keyword
 * alone (any case, surrounding spaces and punctuation ignored), as carriers apply them.
 */
export const STOP_WORDS = [
  'stop',
  'stopall',
  'quit',
  'end',
  'revoke',
  'opt out',
  'optout',
  'cancel',
  'unsubscribe',
];
export const START_WORDS = ['start', 'unstop', 'yes'];
export const HELP_WORDS = ['help', 'info'];

export function parseKeyword(text: string | null | undefined): Keyword | null {
  const t = (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]+$/u, '')
    .replace(/^[\s\p{P}]+/u, '')
    .replace(/\s+/g, ' ');
  if (!t) return null;
  if (STOP_WORDS.includes(t)) return 'stop';
  if (START_WORDS.includes(t)) return 'start';
  if (HELP_WORDS.includes(t)) return 'help';
  return null;
}

/**
 * The HELP reply (carriers and CTIA require one): who sends, how to stop, where to get help.
 * English, like the keywords; the sender is the org when the number is the org's own, else
 * Yayatoh's shared number.
 */
export function helpReply(sender: string | null, supportUrl: string): string {
  const who = sender ? `${sender} via Yayatoh` : 'Yayatoh';
  return `${who}: event messages. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out. Help: ${supportUrl}`;
}
