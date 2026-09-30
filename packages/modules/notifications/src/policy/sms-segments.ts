/**
 * SMS segment counting (roadmap §6.4: "segment counting for GSM-7 and UCS-2"). Carriers bill per
 * segment, so metering and quotas count segments and the composer shows them before sending.
 *
 * - GSM-7 (3GPP TS 23.038 default alphabet): 160 septets in one message; a concatenated message
 *   carries 153 per segment (the user data header takes 7). Characters of the extension table
 *   (`^{}\[~]|€` and form feed) take two septets (escape + character) and are never split across
 *   two segments.
 * - Anything outside that alphabet makes the whole message UCS-2: 70 UTF-16 code units in one
 *   message, 67 per segment when concatenated. Characters outside the BMP (most emoji) take two
 *   code units (a surrogate pair), which are never split either.
 *
 * Six of the thirteen locales (ar, hi, ja, ru, zh-CN, zh-TW) always need UCS-2.
 */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENSION = '\f^{}\\[~]|€';

const BASIC = new Set([...GSM_BASIC]);
const EXTENSION = new Set([...GSM_EXTENSION]);

export const GSM7_SINGLE = 160;
export const GSM7_PER_SEGMENT = 153;
export const UCS2_SINGLE = 70;
export const UCS2_PER_SEGMENT = 67;

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsSegmentCount {
  readonly encoding: SmsEncoding;
  /** Septets (GSM-7) or UTF-16 code units (UCS-2) the text needs. */
  readonly units: number;
  readonly segments: number;
  /** Units a segment holds at this length (160/153 or 70/67). */
  readonly perSegment: number;
  /** Units left in the last segment before another one is needed. */
  readonly remaining: number;
}

/** Whether every character is in the GSM-7 default alphabet or its extension table. */
export function isGsm7(text: string): boolean {
  for (const ch of text) if (!BASIC.has(ch) && !EXTENSION.has(ch)) return false;
  return true;
}

/** Pack indivisible units greedily into segments of `size`; returns how many are needed. */
function pack(units: readonly number[], size: number): { segments: number; lastFill: number } {
  let segments = 1;
  let fill = 0;
  for (const u of units) {
    if (fill + u > size) {
      segments += 1;
      fill = 0;
    }
    fill += u;
  }
  return { segments, lastFill: fill };
}

export function smsSegments(text: string): SmsSegmentCount {
  const gsm = isGsm7(text);
  const units = [...text].map((ch) =>
    gsm ? (EXTENSION.has(ch) ? 2 : 1) : (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1,
  );
  const total = units.reduce((a, b) => a + b, 0);
  const single = gsm ? GSM7_SINGLE : UCS2_SINGLE;
  const multi = gsm ? GSM7_PER_SEGMENT : UCS2_PER_SEGMENT;
  const encoding: SmsEncoding = gsm ? 'GSM-7' : 'UCS-2';
  if (total === 0) return { encoding, units: 0, segments: 0, perSegment: single, remaining: single };
  if (total <= single)
    return { encoding, units: total, segments: 1, perSegment: single, remaining: single - total };
  const { segments, lastFill } = pack(units, multi);
  return { encoding, units: total, segments, perSegment: multi, remaining: multi - lastFill };
}
