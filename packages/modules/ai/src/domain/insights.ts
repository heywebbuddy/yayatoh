import { z } from 'zod';
import { AiOutputError, parseJsonReply } from './compose.ts';

/** AI1: answers one summary reads: the newest ones, and the page says so when there are more. */
export const INSIGHTS_MAX_ANSWERS = 500;
export const INSIGHT_ANSWER_MAX = 1000;
const THEMES_MAX = 6;
const QUOTES_PER_THEME = 2;
const QUOTE_MAX = 240;

export const InsightAnswer = z.object({
  /** `a1`, `a2`, …: what the model cites; a quote shown is always this answer's own text. */
  id: z.string().regex(/^a\d{1,4}$/),
  text: z.string().min(1).max(INSIGHT_ANSWER_MAX),
  rating: z.number().int().min(1).max(5).nullable().default(null),
});
export type InsightAnswer = z.infer<typeof InsightAnswer>;

export const INSIGHT_SENTIMENTS = ['positive', 'mixed', 'negative'] as const;

export const InsightResultDto = z.object({
  summary: z.string().max(800),
  sentiment: z.enum(INSIGHT_SENTIMENTS),
  themes: z
    .array(
      z.object({
        title: z.string().max(80),
        mentions: z.number().int().min(1),
        quotes: z.array(z.string().max(QUOTE_MAX + 1)).max(QUOTES_PER_THEME),
      }),
    )
    .max(THEMES_MAX),
});
export type InsightResultDto = z.infer<typeof InsightResultDto>;

const Raw = z.object({
  summary: z.string(),
  sentiment: z.string().optional(),
  themes: z
    .array(
      z.object({
        title: z.string(),
        mentions: z.number().optional(),
        quotes: z.array(z.string()).optional(),
      }),
    )
    .optional()
    .default([]),
});

const line = (s: string, max: number) =>
  s
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const quote = (text: string) => {
  const flat = line(text, QUOTE_MAX + 1);
  return flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX)}…` : flat;
};

/**
 * Clean a summary reply. A quote is never the model's wording: the reply names answer ids and the
 * text comes from those answers, so nothing can be put in a respondent's mouth. Unknown ids are
 * dropped, a theme's count can't exceed the answers read, and a theme with no real answer behind
 * it is removed.
 */
export function cleanInsights(raw: string, answers: readonly InsightAnswer[]): InsightResultDto {
  const p = Raw.safeParse(parseJsonReply(raw));
  if (!p.success) throw new AiOutputError('insights shape');
  const summary = line(p.data.summary, 800);
  if (!summary) throw new AiOutputError('empty summary');
  const byId = new Map(answers.map((a) => [a.id, a]));
  const themes = p.data.themes.flatMap((t) => {
    const title = line(t.title, 80);
    const cited = [...new Set(t.quotes ?? [])].flatMap((id) => {
      const a = byId.get(id);
      return a ? [quote(a.text)] : [];
    });
    if (!title || cited.length === 0) return [];
    const mentions = Math.round(t.mentions ?? cited.length);
    return [
      {
        title,
        mentions: Math.min(answers.length, Math.max(cited.length, mentions)),
        quotes: cited.slice(0, QUOTES_PER_THEME),
      },
    ];
  });
  const sentiment = (INSIGHT_SENTIMENTS as readonly string[]).includes(p.data.sentiment ?? '')
    ? (p.data.sentiment as (typeof INSIGHT_SENTIMENTS)[number])
    : 'mixed';
  return { summary, sentiment, themes: themes.slice(0, THEMES_MAX) };
}

/** One credit per started 100 answers, at most 5. */
export const insightCredits = (answers: number) => Math.min(5, Math.max(1, Math.ceil(answers / 100)));
