'use server';

import {
  ATTENDANCE_MODES,
  createEventCommand,
  createEventInSeriesCommand,
  setEventDetailsCommand,
} from '@yayatoh/events';
import {
  type Ctx,
  executeCommand,
  executeQuery,
  isDomainError,
  moneyFromDecimal,
  zonedTimeToUtc,
} from '@yayatoh/kernel';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const IDEMPOTENT_CREATE = { ...createEventCommand, idempotent: true };
const IDEMPOTENT_CREATE_IN_SERIES = { ...createEventInSeriesCommand, idempotent: true };

/** U7: the Series field's value — none, one of the org's series, or `new:{name}` (created with the event). */
function seriesChoice(value: string): { seriesId: string } | { newSeriesName: string } | null {
  if (!value) return null;
  return value.startsWith('new:') ? { newSeriesName: value.slice(4).trim() } : { seriesId: value };
}

/** The raw event fields (the command validates them). */
type EventInput = Record<string, unknown>;

/** Create the event, inside its series when one was chosen or named (one transaction). */
async function createEvent(
  input: EventInput,
  series: ReturnType<typeof seriesChoice>,
  ctx: Ctx,
  keyed: boolean,
) {
  if (series)
    return keyed
      ? executeCommand(IDEMPOTENT_CREATE_IN_SERIES, { event: input, ...series }, ctx, ports)
      : executeCommand(createEventInSeriesCommand, { event: input, ...series }, ctx, ports);
  return keyed
    ? executeCommand(IDEMPOTENT_CREATE, input, ctx, ports)
    : executeCommand(createEventCommand, input, ctx, ports);
}

/** The form field a refusal names: nested event fields lose their `event.` prefix. */
function fieldOf(details: Record<string, unknown> | undefined): string | undefined {
  if (typeof details?.field === 'string') return details.field;
  const issues = (details?.issues ?? []) as { path: string }[];
  const path = issues[0]?.path;
  if (!path) return undefined;
  if (path === 'newSeriesName' || path === 'seriesId') return 'series';
  return path.replace(/^event\./, '').split('.')[0] || undefined;
}

export interface CreateEventState {
  readonly code: string | null;
  readonly field?: string;
}

export async function createEventAction(
  org: string,
  _prev: CreateEventState,
  form: FormData,
): Promise<CreateEventState> {
  const data = await loadConsole(org);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const timezone = get('timezone') || data.org.timezone;
  const requestKey = get('requestKey');
  const series = seriesChoice(get('series'));
  // Built inside run(): an unparseable date throws there and is mapped below.
  const input = () => ({
    name: get('name'),
    profile: get('profile') || data.profile,
    timezone,
    // Organizers enter wall-clock times in the event's zone (CLAUDE.md → Time).
    startsAt: zonedTimeToUtc(get('startsAt'), timezone),
    endsAt: zonedTimeToUtc(get('endsAt'), timezone),
    venueName: get('venueName') || null,
    city: get('city') || null,
    currency: data.org.currency,
  });
  // With the form's request key the create is idempotent: a repeated submit gets the same event.
  const run = () =>
    requestKey
      ? createEvent(input(), series, { ...data.ctx, idempotencyKey: requestKey }, true)
      : createEvent(input(), series, data.ctx, false);
  let slug: string;
  try {
    let created: Awaited<ReturnType<typeof run>>;
    try {
      created = await run();
    } catch (err) {
      // A concurrent double submit loses the slug race to its twin; once the twin commits, the
      // same request key replays its result.
      if (!requestKey || !isDomainError(err) || err.details?.field !== 'slug') throw err;
      await new Promise((r) => setTimeout(r, 400));
      created = await run();
    }
    slug = created.slug;
  } catch (err) {
    if (isDomainError(err)) {
      const field = fieldOf(err.details);
      return field ? { code: err.code, field } : { code: err.code };
    }
    if (err instanceof Error && /YYYY-MM-DDTHH:mm/.test(err.message)) return { code: 'validation_failed' };
    throw err;
  }
  return redirect({ href: `/o/${org}/e/${slug}`, locale: await getLocale() });
}

/** Which wizard step owns a field (the wizard jumps back to it on a server error). */
const WIZARD_STEP: Readonly<Record<string, number>> = {
  name: 0,
  tagline: 0,
  profile: 0,
  slug: 0,
  timezone: 1,
  startsAt: 1,
  endsAt: 1,
  venueId: 1,
  venueName: 1,
  city: 1,
  attendanceMode: 1,
  series: 0,
  ticketName: 2,
  ticketPrice: 2,
  ticketQuantity: 2,
};

export interface WizardState {
  readonly code: string | null;
  readonly field?: string;
  readonly step?: number;
}

const wizardError = (code: string, field?: string): WizardState =>
  field ? { code, field, step: WIZARD_STEP[field] ?? 0 } : { code };

/**
 * The three-step wizard (M1.4f): basics → when and where → tickets and the publish checklist.
 * One submit at the end creates the draft (idempotent per wizard), then applies the venue and
 * attendance mode and the optional first ticket type. Everything is validated before anything
 * is written, so a mistake on step 3 never leaves a half-made event.
 */
export async function guidedCreateAction(
  org: string,
  _prev: WizardState,
  form: FormData,
): Promise<WizardState> {
  const data = await loadConsole(org);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const timezone = get('timezone') || data.org.timezone;
  const requestKey = get('requestKey');
  const attendanceMode = (ATTENDANCE_MODES as readonly string[]).includes(get('attendanceMode'))
    ? (get('attendanceMode') as (typeof ATTENDANCE_MODES)[number])
    : 'in_person';
  const venueId = get('venueId') || null;
  const series = seriesChoice(get('series'));
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = zonedTimeToUtc(get('startsAt'), timezone);
  } catch {
    return wizardError('validation_failed', 'startsAt');
  }
  try {
    endsAt = zonedTimeToUtc(get('endsAt'), timezone);
  } catch {
    return wizardError('validation_failed', 'endsAt');
  }
  // The optional first pass: all or nothing, checked before the event exists.
  const ticketName = get('ticketName');
  const ticketQuantity = get('ticketQuantity');
  const ticketPrice = get('ticketPrice');
  let ticket: { name: string; priceMinor: number; quantityTotal: number } | null = null;
  if (ticketName || ticketQuantity || ticketPrice) {
    if (!ticketName || ticketName.length > 120) return wizardError('validation_failed', 'ticketName');
    const quantity = Number(ticketQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000)
      return wizardError('validation_failed', 'ticketQuantity');
    let priceMinor: number;
    try {
      priceMinor = moneyFromDecimal(ticketPrice || '0', data.org.currency).amount;
    } catch {
      return wizardError('validation_failed', 'ticketPrice');
    }
    ticket = { name: ticketName, priceMinor, quantityTotal: quantity };
  }
  const input = {
    name: get('name'),
    tagline: get('tagline') || null,
    profile: get('profile') || data.profile,
    timezone,
    startsAt,
    endsAt,
    venueName: venueId ? null : get('venueName') || null,
    city: venueId ? null : get('city') || null,
    currency: data.org.currency,
  };
  let slug: string;
  try {
    const ctx = requestKey ? { ...data.ctx, idempotencyKey: `wizard:${requestKey}` } : data.ctx;
    const created = await createEvent(input, series, ctx, Boolean(requestKey));
    slug = created.slug;
    if (venueId || attendanceMode !== 'in_person')
      await executeCommand(
        setEventDetailsCommand,
        { eventId: created.id, ...(venueId ? { venueId } : {}), attendanceMode },
        data.ctx,
        ports,
      );
    if (ticket && data.modules.has('ticketing')) {
      const existing = await executeQuery(listTicketTypesQuery, { eventId: created.id }, data.ctx, ports);
      // A repeated submit (same wizard) replays the event; don't add its pass twice.
      if (!existing.some((x) => x.name === ticket.name))
        await executeCommand(createTicketTypeCommand, { eventId: created.id, ...ticket }, data.ctx, ports);
    }
  } catch (err) {
    if (isDomainError(err)) {
      return wizardError(err.code, fieldOf(err.details));
    }
    throw err;
  }
  return redirect({ href: `/o/${org}/e/${slug}/setup-guide`, locale: await getLocale() });
}
