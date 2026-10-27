import { z } from 'zod';
import { AiOutputError, parseJsonReply } from './compose.ts';

/**
 * The attendee assistant: a question about one event, answered **only** from that event's own
 * published details. The web app builds the numbered sources (time, venue, FAQs, agenda, tickets,
 * policies); the model must answer from them and name the ones it used. The reply is cleaned and
 * checked here: an answer that cites nothing real is treated as "I don't know", so a model can
 * neither answer from memory nor invent a source.
 */
export const ASSISTANT_QUESTION_MAX = 300;
export const ASSISTANT_SOURCES_MAX = 60;
export const ASSISTANT_SOURCE_TEXT_MAX = 700;
export const ASSISTANT_CONTEXT_BUDGET = 14_000;
export const ASSISTANT_ANSWER_MAX = 700;
export const ASSISTANT_CITATIONS_MAX = 4;

export const AssistantSource = z.object({
  /** `s1`, `s2`, …: what the model cites and the page maps back to a label and a link. */
  id: z.string().regex(/^s\d{1,3}$/),
  /** Shown to the attendee beside the answer ("FAQ: Is there parking?"). */
  label: z.string().min(1).max(160),
  text: z.string().min(1).max(ASSISTANT_SOURCE_TEXT_MAX),
});
export type AssistantSource = z.infer<typeof AssistantSource>;

export const AssistantAnswerDto = z.object({
  /** False: the sources do not answer the question (the page offers human help). */
  known: z.boolean(),
  answer: z.string().max(ASSISTANT_ANSWER_MAX),
  /** The sources the answer rests on, in citation order (empty when not known). */
  sourceIds: z.array(z.string()).max(ASSISTANT_CITATIONS_MAX),
});
export type AssistantAnswerDto = z.infer<typeof AssistantAnswerDto>;

/** Keep sources within the prompt budget, in order; each is cut to its own limit. */
export function fitSources(sources: readonly AssistantSource[]): AssistantSource[] {
  const out: AssistantSource[] = [];
  let used = 0;
  for (const s of sources.slice(0, ASSISTANT_SOURCES_MAX)) {
    const text =
      s.text.length > ASSISTANT_SOURCE_TEXT_MAX ? s.text.slice(0, ASSISTANT_SOURCE_TEXT_MAX) : s.text;
    if (used + text.length > ASSISTANT_CONTEXT_BUDGET) break;
    used += text.length;
    out.push({ ...s, text });
  }
  return out;
}

const Raw = z.object({
  known: z.boolean().optional().default(false),
  answer: z.string().optional().default(''),
  sources: z.array(z.string()).optional().default([]),
});

const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const stripTags = (s: string) => s.replace(/<\/?[a-zA-Z][^>]*>/g, '');

/**
 * Clean the assistant's reply. Known only when the model says so, wrote an answer, and cited at
 * least one real source. Links in the answer are dropped unless a source contains them, and
 * markup never reaches the page (the answer is plain text).
 */
export function cleanAssistantAnswer(raw: string, sources: readonly AssistantSource[]): AssistantAnswerDto {
  let parsed: z.infer<typeof Raw>;
  try {
    const p = Raw.safeParse(parseJsonReply(raw));
    if (!p.success) throw new AiOutputError('assistant shape');
    parsed = p.data;
  } catch (err) {
    if (err instanceof AiOutputError) throw err;
    throw new AiOutputError('assistant reply');
  }
  const valid = new Set(sources.map((s) => s.id));
  const cited = [...new Set(parsed.sources.filter((id) => valid.has(id)))].slice(0, ASSISTANT_CITATIONS_MAX);
  const allText = sources.map((s) => s.text).join('\n');
  const answer = stripTags(parsed.answer)
    .replace(URL_RE, (u) => (allText.includes(u) ? u : ''))
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, ASSISTANT_ANSWER_MAX);
  if (!parsed.known || !answer || cited.length === 0) return { known: false, answer: '', sourceIds: [] };
  return { known: true, answer, sourceIds: cited };
}

/** A tiny lexical match for the fake drafter: which sources share words with the question. */
export function rankSources(question: string, sources: readonly AssistantSource[]): AssistantSource[] {
  const words = new Set(
    question
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3),
  );
  const ranked = sources
    .map((s) => {
      const hay = `${s.label} ${s.text}`.toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score++;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
  // "When", "where" and friends: the first source is the event's own summary (dates, time zone, place).
  const first = sources[0];
  if (
    first &&
    /\b(when|time|date|day|start|starts|begin|end|ends|where|place|venue|address|location|city|open|doors)\b/i.test(
      question,
    )
  )
    return ranked.some((r) => r.id === first.id) ? ranked : [...ranked, first];
  return ranked;
}
