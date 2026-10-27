import { EVENT_PROFILES, markdownToPlainText, sanitizeMarkdown } from '@yayatoh/events';
import { z } from 'zod';
import { AiOutputError, addMinutesLocal, cleanAgendaDraft, parseJsonReply } from './compose.ts';

/**
 * "Create with AI" (step 5 of the showcase work): the organizer describes an event in a sentence or
 * two and the AI proposes a whole draft: name, profile, dates, venue text, description, ticket
 * types with prices, an agenda outline and FAQs. Like every AI result this is a **preview**: the
 * organizer edits it, and only then does the web app create a draft event through the normal
 * commands. Nothing here touches the database.
 */

export const SETUP_MAX_TICKETS = 6;
export const SETUP_MAX_AGENDA = 12;
export const SETUP_MAX_FAQS = 8;

export const SetupTicketDto = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  /** In whole currency units, at most two decimals (the web converts to minor units). */
  price: z.number().min(0).max(100_000),
  quantity: z.int().min(1).max(100_000),
});
export type SetupTicketDto = z.infer<typeof SetupTicketDto>;

export const SetupAgendaItemDto = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000),
  startsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
  minutes: z.int().min(10).max(240),
});
export type SetupAgendaItemDto = z.infer<typeof SetupAgendaItemDto>;

export const SetupFaqDto = z.object({
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(1500),
});
export type SetupFaqDto = z.infer<typeof SetupFaqDto>;

export const EventSetupDraftDto = z.object({
  name: z.string().min(2).max(160),
  tagline: z.string().max(280),
  profile: z.enum(EVENT_PROFILES),
  /** Wall clock in the organizer's time zone, "YYYY-MM-DD HH:MM". */
  startsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
  endsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
  venueName: z.string().max(160),
  city: z.string().max(120),
  description: z.string().max(6000),
  tickets: z.array(SetupTicketDto).max(SETUP_MAX_TICKETS),
  agenda: z.array(SetupAgendaItemDto).max(SETUP_MAX_AGENDA),
  faqs: z.array(SetupFaqDto).max(SETUP_MAX_FAQS),
});
export type EventSetupDraftDto = z.infer<typeof EventSetupDraftDto>;

/** What the cleaner needs to know about the request (the model's dates are checked against it). */
export interface SetupBounds {
  /** The organizer's today, `YYYY-MM-DD`: an event cannot start before it. */
  readonly today: string;
  /** Profiles the organizer may pick (their entitled event types). */
  readonly profiles: readonly string[];
}

const stripTags = (s: string) => s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
const cut = (s: string, max: number) => {
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  const space = c.lastIndexOf(' ');
  return (space > max / 2 ? c.slice(0, space) : c).trimEnd();
};
const oneLine = (s: unknown, max: number) =>
  cut(
    markdownToPlainText(sanitizeMarkdown(stripTags(String(s ?? '')), 4000))
      .replace(/\s+/g, ' ')
      .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
      .trim(),
    max,
  );
const plain = (s: unknown, max: number) =>
  cut(
    markdownToPlainText(sanitizeMarkdown(stripTags(String(s ?? '')), 8000))
      .replace(/[ \t]+/g, ' ')
      .trim(),
    max,
  );

const Local = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const Raw = z.object({
  name: z.string(),
  tagline: z.string().optional().default(''),
  profile: z.string().optional().default('other'),
  startsLocal: z.string(),
  endsLocal: z.string().optional(),
  venueName: z.string().nullable().optional().default(''),
  city: z.string().nullable().optional().default(''),
  description: z.string().optional().default(''),
  tickets: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().nullable().optional().default(''),
        price: z.number(),
        quantity: z.number(),
      }),
    )
    .optional()
    .default([]),
  agenda: z.array(z.unknown()).optional().default([]),
  faqs: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .optional()
    .default([]),
});

/**
 * Clean a setup reply into an editable proposal. Hard rules (a break makes the reply unusable):
 * a name, and a start that is a real wall-clock time not before today. Everything else is
 * tidied or dropped: plain text for names and lines, the Markdown subset for the description, a
 * profile outside the organizer's list becomes `other`, prices are rounded to cents, duplicate
 * ticket names are dropped, and agenda items must sit inside the event's own dates.
 */
export function cleanEventSetupDraft(raw: string, bounds: SetupBounds): EventSetupDraftDto {
  const p = Raw.safeParse(parseJsonReply(raw));
  if (!p.success) throw new AiOutputError('setup shape');
  const d = p.data;
  const startsLocal = d.startsLocal.trim();
  if (!Local.test(startsLocal) || !addMinutesLocal(startsLocal, 0)) throw new AiOutputError('start');
  if (startsLocal.slice(0, 10) < bounds.today) throw new AiOutputError('start in the past');
  let endsLocal = (d.endsLocal ?? '').trim();
  if (!Local.test(endsLocal) || !addMinutesLocal(endsLocal, 0) || endsLocal <= startsLocal)
    endsLocal = addMinutesLocal(startsLocal, 180) ?? startsLocal;
  const seen = new Set<string>();
  const tickets: SetupTicketDto[] = [];
  for (const t of d.tickets) {
    const name = oneLine(t.name, 120);
    const key = name.toLowerCase();
    const price = Math.round(t.price * 100) / 100;
    const quantity = Math.round(t.quantity);
    const ok = SetupTicketDto.safeParse({ name, description: plain(t.description, 500), price, quantity });
    if (!name || seen.has(key) || !ok.success) continue;
    seen.add(key);
    tickets.push(ok.data);
    if (tickets.length >= SETUP_MAX_TICKETS) break;
  }
  let agenda: SetupAgendaItemDto[] = [];
  if (d.agenda.length > 0) {
    try {
      agenda = cleanAgendaDraft(
        JSON.stringify({ sessions: d.agenda }),
        { startsLocal, endsLocal },
        SETUP_MAX_AGENDA,
      ).sessions;
    } catch {
      // An agenda is optional: none of it usable means none proposed.
    }
  }
  const faqs: SetupFaqDto[] = [];
  for (const f of d.faqs) {
    const ok = SetupFaqDto.safeParse({ question: oneLine(f.question, 300), answer: plain(f.answer, 1500) });
    if (ok.success) faqs.push(ok.data);
    if (faqs.length >= SETUP_MAX_FAQS) break;
  }
  const profile = bounds.profiles.includes(d.profile) ? d.profile : 'other';
  const draft = {
    name: oneLine(d.name, 160),
    tagline: oneLine(d.tagline, 280),
    profile,
    startsLocal,
    endsLocal,
    venueName: oneLine(d.venueName, 160),
    city: oneLine(d.city, 120),
    description: sanitizeMarkdown(stripTags(d.description).replace(/^#{1,6}\s+/gm, ''), 6000),
    tickets,
    agenda,
    faqs,
  };
  const ok = EventSetupDraftDto.safeParse(draft);
  if (!ok.success) throw new AiOutputError('setup content');
  return ok.data;
}
