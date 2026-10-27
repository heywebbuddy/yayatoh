'use server';

import { askEventAssistant, rankSources } from '@yayatoh/ai';
import { createCtx, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { aiDrafter } from '@/server/ai.ts';
import { eventKnowledge } from '@/server/event-assistant.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

/** What the assistant box shows for one question. */
export type AssistantReply =
  | {
      readonly kind: 'answer';
      readonly known: boolean;
      /** `search`: no AI provider, the closest match from the event's own details (no credit spent). */
      readonly mode: 'ai' | 'search';
      readonly answer: string;
      /** The sources the answer rests on, with the page anchor when the source has one. */
      readonly citations: readonly { readonly label: string; readonly href: string | null }[];
    }
  | { readonly kind: 'rate_limited'; readonly minutes: number }
  /** The organizer has not turned it on, or the event is not public. */
  | { readonly kind: 'off' }
  /** No AI provider, no credits left, or the provider failed (the credit is refunded). */
  | { readonly kind: 'unavailable' };

/**
 * An attendee's question to an event's assistant (public event page, attendee portal). The event
 * comes from the slug, never from the form; the answer rests only on that event's published
 * data; the organizer must have turned the assistant on; bursts are rate limited per device,
 * address and event; one AI credit of the organizer is spent per answer (refunded on failure).
 */
export async function askAssistantAction(slug: string, question: string): Promise<AssistantReply> {
  const q = String(question ?? '')
    .trim()
    .slice(0, 300);
  if (q.length < 3 || slug.length > 200) return { kind: 'off' };
  const limit = await limitAction('eventAssistant', { identity: `assistant:${slug}` });
  if (!limit.allowed) return { kind: 'rate_limited', minutes: retryAfterMinutes(limit) };
  const locale = await getLocale();
  const knowledge = await eventKnowledge(slug, locale);
  if (!knowledge || knowledge.sources.length === 0) return { kind: 'off' };
  const drafter = aiDrafter();
  if (!drafter) {
    // AI is off: answer by keyword from the event's FAQs, agenda, times and tickets, and cite it.
    const best = rankSources(q, knowledge.sources).slice(0, 2);
    return {
      kind: 'answer',
      mode: 'search',
      known: best.length > 0,
      answer: best.map((s) => s.text).join('\n\n'),
      citations: best.map((s) => ({ label: s.label, href: knowledge.anchors[s.id] ?? null })),
    };
  }
  try {
    const res = await askEventAssistant(createCtx({ orgId: knowledge.orgId }), ports, drafter, {
      eventId: knowledge.eventId,
      question: q,
      locale,
      eventName: knowledge.eventName,
      sources: [...knowledge.sources],
    });
    return {
      kind: 'answer',
      mode: 'ai',
      known: res.known,
      answer: res.answer,
      citations: res.sourceIds.flatMap((id) => {
        const s = knowledge.sources.find((x) => x.id === id);
        return s ? [{ label: s.label, href: knowledge.anchors[id] ?? null }] : [];
      }),
    };
  } catch (err) {
    if (isDomainError(err)) return { kind: 'unavailable' };
    throw err;
  }
}
