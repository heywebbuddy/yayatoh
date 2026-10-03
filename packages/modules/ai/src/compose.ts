import { previewAudienceQuery } from '@yayatoh/audiences';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { eventDetailsQuery, getEventQuery, listEventsQuery } from '@yayatoh/events';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeQuery,
  requireOrg,
  utcToZonedInput,
  zonedTimeToUtc,
} from '@yayatoh/kernel';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { z } from 'zod';
import { brandVoiceTx } from './brand-kits.ts';
import {
  AGENDA_MAX_SESSIONS,
  AudienceSuggestionDto,
  type BrandVoice,
  CampaignDraftDto,
  cleanAgendaDraft,
  cleanAudienceSuggestion,
  cleanCampaignDraft,
  cleanPageDraft,
  MAX_BRIEF_LENGTH,
  PageDraftDto,
} from './domain/compose.ts';
import type { DraftFacts } from './domain/drafts.ts';
import { TONES } from './domain/tones.ts';
import type { AiDrafter } from './drafter.ts';
import { chargedCall, contentCredits, eventCredits, messagingCredits, withTimeout } from './spend.ts';

const Common = {
  tone: z.enum(TONES).default('friendly'),
  brandKitId: z.uuid().nullable().default(null),
  brief: z.string().trim().max(MAX_BRIEF_LENGTH).default(''),
  locale: z.string().max(20).default('en'),
};

export const DraftCampaignInput = z.object({ ...Common, eventId: z.uuid().nullable().default(null) });
export type DraftCampaignInput = z.input<typeof DraftCampaignInput>;
export const DraftPageInput = DraftCampaignInput;
export type DraftPageInput = z.input<typeof DraftPageInput>;
export const DraftAgendaInput = z.object({
  ...Common,
  eventId: z.uuid(),
  sessions: z.number().int().min(1).max(AGENDA_MAX_SESSIONS).default(4),
});
export type DraftAgendaInput = z.input<typeof DraftAgendaInput>;
export const SuggestAudienceInput = z.object({
  brief: z.string().trim().min(3).max(MAX_BRIEF_LENGTH),
  locale: z.string().max(20).default('en'),
});
export type SuggestAudienceInput = z.input<typeof SuggestAudienceInput>;

export const CampaignDraftResultDto = z.object({ draft: CampaignDraftDto, balance: z.number().int() });
export type CampaignDraftResultDto = z.infer<typeof CampaignDraftResultDto>;
export const PageDraftResultDto = z.object({ draft: PageDraftDto, balance: z.number().int() });
export type PageDraftResultDto = z.infer<typeof PageDraftResultDto>;
export const AgendaProposalDto = z.object({
  title: z.string(),
  description: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
});
export type AgendaProposalDto = z.infer<typeof AgendaProposalDto>;
export const AgendaDraftResultDto = z.object({
  sessions: z.array(AgendaProposalDto),
  timezone: z.string(),
  balance: z.number().int(),
});
export type AgendaDraftResultDto = z.infer<typeof AgendaDraftResultDto>;
export const AudienceSuggestionResultDto = AudienceSuggestionDto.extend({
  count: z.number().int(),
  balance: z.number().int(),
});
export type AudienceSuggestionResultDto = z.infer<typeof AudienceSuggestionResultDto>;

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const p = schema.safeParse(raw);
  if (!p.success)
    throw new DomainError('validation_failed', 'Invalid AI request', {
      issues: p.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
    });
  return p.data;
}

const requireDrafter = (d: AiDrafter | null): AiDrafter => {
  if (!d) throw new DomainError('invalid_state', 'AI drafting is off', { reason: 'ai_unavailable' });
  return d;
};

const local = (d: Date, tz: string) => utcToZonedInput(d, tz).replace('T', ' ');

/** The event's facts as a draft sees them (events:read). */
export async function eventFacts(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  eventId: string,
): Promise<DraftFacts> {
  const ev = await executeQuery(getEventQuery, { eventId }, ctx, ports);
  const details = await executeQuery(eventDetailsQuery, { eventId }, ctx, ports);
  return {
    name: ev.name,
    profile: ev.profile,
    startsLocal: local(ev.startsAt, ev.timezone),
    endsLocal: local(ev.endsAt, ev.timezone),
    timezone: ev.timezone,
    venueName: ev.venueName,
    city: ev.city,
    attendanceMode: details.attendanceMode,
    category: details.category,
    tagline: ev.tagline,
  };
}

/** The org's name and the chosen brand kit (the kit must be this org's: RLS scopes the read). */
async function orgAndBrand(
  ctx: Ctx,
  kitId: string | null,
): Promise<{ orgName: string; brand: BrandVoice | null }> {
  return withTenant(ctx, async (tx) => {
    const org = await organizationBrandTx(tx, requireOrg(ctx));
    const brand = kitId ? await brandVoiceTx(tx, kitId) : null;
    if (kitId && !brand) throw new DomainError('not_found', 'Brand kit not found', { field: 'brandKitId' });
    return { orgName: org?.name ?? '', brand };
  });
}

/** M6.12b: draft a campaign email (subject, preheader, heading, paragraphs, button label). */
export async function draftCampaign(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: DraftCampaignInput,
): Promise<CampaignDraftResultDto> {
  const input = parse(DraftCampaignInput, raw);
  const ai = requireDrafter(drafter);
  const { orgName, brand } = await orgAndBrand(ctx, input.brandKitId);
  const event = input.eventId ? await eventFacts(ctx, ports, input.eventId) : null;
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    messagingCredits,
    { purpose: 'campaign', eventId: input.eventId },
    async () =>
      cleanCampaignDraft(
        await withTimeout(
          ai.compose({
            task: 'campaign',
            locale: input.locale,
            tone: input.tone,
            brand,
            orgName,
            brief: input.brief,
            event,
          }),
        ),
      ),
  );
  return { draft: value, balance };
}

/** M6.12b: draft a site page (title, excerpt, Markdown body). */
export async function draftPage(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: DraftPageInput,
): Promise<PageDraftResultDto> {
  const input = parse(DraftPageInput, raw);
  const ai = requireDrafter(drafter);
  const { orgName, brand } = await orgAndBrand(ctx, input.brandKitId);
  const event = input.eventId ? await eventFacts(ctx, ports, input.eventId) : null;
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    contentCredits,
    { purpose: 'page', eventId: input.eventId },
    async () =>
      cleanPageDraft(
        await withTimeout(
          ai.compose({
            task: 'page',
            locale: input.locale,
            tone: input.tone,
            brand,
            orgName,
            brief: input.brief,
            event,
          }),
        ),
      ),
  );
  return { draft: value, balance };
}

/**
 * M6.12b: propose agenda sessions inside the event's dates. The proposals come back as instants
 * (converted from the event's wall clock); the organizer picks which to add.
 */
export async function draftAgenda(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: DraftAgendaInput,
): Promise<AgendaDraftResultDto> {
  const input = parse(DraftAgendaInput, raw);
  const ai = requireDrafter(drafter);
  const { orgName, brand } = await orgAndBrand(ctx, input.brandKitId);
  const event = await eventFacts(ctx, ports, input.eventId);
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    eventCredits,
    { purpose: 'agenda', eventId: input.eventId },
    async () =>
      cleanAgendaDraft(
        await withTimeout(
          ai.compose({
            task: 'agenda',
            locale: input.locale,
            tone: input.tone,
            brand,
            orgName,
            brief: input.brief,
            event,
            sessions: input.sessions,
          }),
        ),
        event,
        input.sessions,
      ),
  );
  const at = (l: string) => zonedTimeToUtc(l.replace(' ', 'T'), event.timezone);
  return {
    sessions: value.sessions.map((s) => {
      const startsAt = at(s.startsLocal);
      return {
        title: s.title,
        description: s.description,
        startsAt,
        endsAt: new Date(startsAt.getTime() + s.minutes * 60_000),
      };
    }),
    timezone: event.timezone,
    balance,
  };
}

/** Events an audience suggestion may reference: the org's 30 latest. */
export const AUDIENCE_EVENTS = 30;

/**
 * M6.12b: suggest an audience as a segment definition in the existing DSL, with its size. Nothing
 * is saved: the organizer reviews it in the builder and saves it there.
 */
export async function suggestAudience(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: SuggestAudienceInput,
): Promise<AudienceSuggestionResultDto> {
  const input = parse(SuggestAudienceInput, raw);
  const ai = requireDrafter(drafter);
  const { orgName } = await orgAndBrand(ctx, null);
  const all = await executeQuery(listEventsQuery, {}, ctx, ports);
  const events = all.slice(-AUDIENCE_EVENTS).map((e) => ({
    id: e.id,
    name: e.name,
    startsLocal: local(e.startsAt, e.timezone),
  }));
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    messagingCredits,
    { purpose: 'audience', eventId: null },
    async () =>
      cleanAudienceSuggestion(
        await withTimeout(
          ai.compose({
            task: 'audience',
            locale: input.locale,
            tone: 'friendly',
            brand: null,
            orgName,
            brief: input.brief,
            events,
            today: ctx.now.toISOString().slice(0, 10),
          }),
        ),
        events.map((e) => e.id),
      ),
  );
  // Sizing runs the normal preview (it compiles for this org and applies the money gate).
  const preview = await executeQuery(
    previewAudienceQuery,
    { definition: value.definition, limit: 1 },
    ctx,
    ports,
  );
  return { ...value, count: preview.count, balance };
}
