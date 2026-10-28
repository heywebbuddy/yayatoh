'use server';

import { type EventSetupDraftDto, isTimeZone, proposeEventSetup } from '@yayatoh/ai';
import {
  addPickupPointCommand,
  addRecurringOccurrencesCommand,
  addSectionCommand,
  createEventCommand,
} from '@yayatoh/events';
import { executeCommand, isDomainError, moneyFromDecimal, zonedTimeToUtc } from '@yayatoh/kernel';
import { createSessionCommand } from '@yayatoh/program';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { getLocale, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { PICKER_ORDER } from '@/lib/profile-picker.ts';
import { aiDrafter } from '@/server/ai.ts';
import { aiCall, composeArgs } from '@/server/ai-compose.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** A proposal as the review form shows it, with the zone and currency its times and prices are in. */
export interface EventSetupProposal {
  readonly draft: EventSetupDraftDto;
  readonly timezone: string;
  readonly currency: string;
}

/**
 * "Create with AI", step one: propose a draft event from a sentence or two. A preview only (one AI
 * credit, refunded on failure): nothing is created until the organizer confirms the reviewed form.
 */
export async function proposeEventAction(
  org: string,
  values: unknown,
): Promise<AiComposeResult<EventSetupProposal>> {
  const data = await loadConsole(org);
  const v = composeArgs(values);
  return aiCall({ orgId: data.org.id, userId: data.session.userId, key: 'event-setup' }, async () => {
    const res = await proposeEventSetup(data.ctx, ports, aiDrafter(), {
      brief: v.brief,
      tone: v.tone,
      locale: await getLocale(),
      timezone: data.org.timezone,
      currency: data.org.currency,
      profiles: [...PICKER_ORDER],
    });
    return {
      value: { draft: res.draft, timezone: res.timezone, currency: res.currency },
      balance: res.balance,
    };
  });
}

const Local = z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/);

/** What the review form posts: the organizer's edits of the proposal. */
const Confirmed = z.object({
  requestKey: z.string().min(8).max(80),
  name: z.string().trim().min(2).max(160),
  tagline: z.string().trim().max(280),
  profile: z.string().max(30),
  startsLocal: Local,
  endsLocal: Local,
  venueName: z.string().trim().max(160),
  city: z.string().trim().max(120),
  /** The zone the proposal's times are in (the event's own place, else the organization's). */
  timezone: z.string().max(64).nullable().default(null),
  repeatDays: z.coerce.number().int().min(0).max(30).default(0),
  pickups: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  description: z.string().max(6000),
  tickets: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500),
        price: z.string().trim().max(12),
        quantity: z.coerce.number().int().min(1).max(100_000),
      }),
    )
    .max(6),
  agenda: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().max(1000),
        startsLocal: Local,
        minutes: z.coerce.number().int().min(10).max(240),
      }),
    )
    .max(24),
  faqs: z
    .array(
      z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(1500) }),
    )
    .max(8),
});

export interface CreateFromAiState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: string;
  readonly slug?: string;
  /** Parts of the proposal that could not be added (the event itself was created). */
  readonly skipped?: readonly string[];
}

const at = (local: string, tz: string) => zonedTimeToUtc(local.replace(' ', 'T'), tz);

/**
 * "Create with AI", step two, after the organizer reviewed and edited the proposal and pressed
 * Create: a **draft** event through the normal commands (event, description and FAQ sections,
 * ticket types, agenda sessions). Each part is added by its own command, so permissions, limits
 * and audit apply as if it were typed by hand. A repeated submit (same request key) replays the
 * same event.
 */
export async function createFromAiAction(org: string, payload: unknown): Promise<CreateFromAiState> {
  const data = await loadConsole(org);
  const parsed = Confirmed.safeParse(payload);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, code: 'validation_failed', ...(typeof field === 'string' ? { field } : {}) };
  }
  const p = parsed.data;
  const timezone = isTimeZone(p.timezone) ? p.timezone : data.org.timezone;
  const currency = data.org.currency;
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = at(p.startsLocal, timezone);
    endsAt = at(p.endsLocal, timezone);
  } catch {
    return { ok: false, code: 'validation_failed', field: 'startsLocal' };
  }
  const t = await getTranslations('aiSetup');
  const skipped: string[] = [];
  try {
    const created = await executeCommand(
      { ...createEventCommand, idempotent: true },
      {
        name: p.name,
        tagline: p.tagline || null,
        profile: (PICKER_ORDER as readonly string[]).includes(p.profile) ? p.profile : data.profile,
        timezone,
        startsAt,
        endsAt,
        venueName: p.venueName || null,
        city: p.city || null,
        currency,
      },
      { ...data.ctx, idempotencyKey: `ai-setup:${p.requestKey}` },
      ports,
    );
    const eventId = created.id;
    const part = async (label: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (err) {
        if (!isDomainError(err)) throw err;
        skipped.push(label);
      }
    };
    if (p.description.trim())
      await part('description', () =>
        executeCommand(
          addSectionCommand,
          { eventId, title: t('sections.about'), kind: 'text', content: { markdown: p.description } },
          data.ctx,
          ports,
        ),
      );
    if (p.faqs.length > 0)
      await part('faqs', () =>
        executeCommand(
          addSectionCommand,
          { eventId, title: t('sections.faq'), kind: 'faq', content: { items: p.faqs } },
          data.ctx,
          ports,
        ),
      );
    if (data.modules.has('ticketing'))
      for (const [i, tk] of p.tickets.entries())
        await part('tickets', async () => {
          const priceMinor = moneyFromDecimal(tk.price || '0', currency).amount;
          await executeCommand(
            createTicketTypeCommand,
            {
              eventId,
              name: tk.name,
              description: tk.description || null,
              priceMinor,
              quantityTotal: tk.quantity,
              sortOrder: i,
            },
            data.ctx,
            ports,
          );
        });
    else if (p.tickets.length > 0) skipped.push('tickets');
    if (data.modules.has('sessions'))
      for (const s of p.agenda)
        await part('agenda', async () => {
          const start = at(s.startsLocal, timezone);
          await executeCommand(
            createSessionCommand,
            {
              eventId,
              title: s.title,
              description: s.description,
              startsAt: start,
              endsAt: new Date(start.getTime() + s.minutes * 60_000),
            },
            data.ctx,
            ports,
          );
        });
    else if (p.agenda.length > 0) skipped.push('agenda');
    if (p.profile === 'tour') {
      for (const [i, name] of p.pickups.entries())
        await part('pickups', () =>
          executeCommand(
            addPickupPointCommand,
            { eventId, name, address: '', minutesBefore: i === 0 ? 15 : 0 },
            data.ctx,
            ports,
          ),
        );
      // "Daily": the first date is the event itself; the rest are added as a repeating schedule.
      if (p.repeatDays > 1)
        await part('repeat', () =>
          executeCommand(
            addRecurringOccurrencesCommand,
            {
              eventId,
              rule: {
                startDate: p.startsLocal.slice(0, 10),
                startTime: p.startsLocal.slice(11, 16),
                endTime: p.endsLocal.slice(11, 16),
                freq: 'daily',
                interval: 1,
                count: p.repeatDays,
              },
            },
            data.ctx,
            ports,
          ),
        );
    }
    return { ok: true, code: null, slug: created.slug, skipped: [...new Set(skipped)] };
  } catch (err) {
    if (isDomainError(err)) return { ok: false, code: err.code };
    throw err;
  }
}
