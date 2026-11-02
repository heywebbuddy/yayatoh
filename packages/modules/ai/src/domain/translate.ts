import { z } from 'zod';
import { AiOutputError, parseJsonReply } from './compose.ts';

/** One call must finish inside the caller's budget: longer texts are translated by hand for now. */
export const TRANSLATE_MAX_WORDS = 2000;
export const TRANSLATE_SEGMENTS_MAX = 60;

export const countWords = (segments: Readonly<Record<string, string>>) =>
  Object.values(segments).reduce((n, s) => n + (s.trim().match(/\S+/g)?.length ?? 0), 0);

/** One credit per started 1,000 source words. */
export const translateCredits = (words: number) => Math.max(1, Math.ceil(words / 1000));

const URL_RE = /https?:\/\/[^\s)>\]]+/g;
const MERGE_RE = /\{\{[^{}]*\}\}/g;
const sorted = (s: string, re: RegExp) => (s.match(re) ?? []).sort();
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const Raw = z.object({ segments: z.record(z.string(), z.string()) });

/**
 * Clean a translation. It must have every source segment and no others, and keep each one's links
 * and merge fields exactly: a changed link or `{{first_name}}` would break the message, so such a
 * reply is unusable (refunded) rather than repaired. Empty source text stays empty.
 */
export function cleanTranslation(
  raw: string,
  source: Readonly<Record<string, string>>,
): Record<string, string> {
  const p = Raw.safeParse(parseJsonReply(raw));
  if (!p.success) throw new AiOutputError('translation shape');
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(source)) {
    if (!text.trim()) {
      out[key] = text;
      continue;
    }
    const translated = p.data.segments[key]?.replace(/<\/?[a-zA-Z][^>]*>/g, (m) =>
      text.includes(m) ? m : '',
    );
    if (!translated?.trim()) throw new AiOutputError(`missing segment ${key}`);
    if (!same(sorted(text, URL_RE), sorted(translated, URL_RE))) throw new AiOutputError('links changed');
    if (!same(sorted(text, MERGE_RE), sorted(translated, MERGE_RE)))
      throw new AiOutputError('merge fields changed');
    out[key] = translated.trim();
  }
  return out;
}
