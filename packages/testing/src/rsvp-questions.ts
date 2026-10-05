import {
  guestListQuery,
  publishRsvpQuestionsCommand,
  saveMenuOptionCommand,
  subEventsQuery,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { ports } from './ports.ts';
import { type RsvpScenario, rsvpScenario } from './rsvp.ts';

export interface RsvpQuestionsScenario extends RsvpScenario {
  readonly ceremonyId: string;
  readonly receptionId: string;
  /** Guest ids: Luis López, his placeholder plus-one and Ana García (Garcia); Mei Chen (Chen). */
  readonly luis: string;
  readonly plus: string;
  readonly ana: string;
  readonly mei: string;
  /** Menu option ids. */
  readonly fish: string;
  readonly veg: string;
}

/**
 * The standard RSVP questions (M4.1e): the reception's meal (attending only, required), a
 * dietary question saved to the sealed fields, and the ceremony's song request (attending adults).
 */
export const standardRsvpQuestions = (s: { ceremonyId: string; receptionId: string }) => ({
  questions: [
    {
      key: 'meal',
      type: 'meal' as const,
      label: 'Reception: meal choice',
      subEventId: s.receptionId,
      required: true,
      showIf: { '==': [{ var: 'attending' }, true] },
    },
    {
      key: 'dietary',
      type: 'long_text' as const,
      label: 'Allergies or dietary needs',
      sensitive: true,
      binding: 'dietary' as const,
    },
    {
      key: 'song',
      type: 'short_text' as const,
      label: 'Ceremony: song request',
      subEventId: s.ceremonyId,
      showIf: { and: [{ '==': [{ var: 'attending' }, true] }, { '==': [{ var: 'age_class' }, 'adult'] }] },
    },
  ],
});

/**
 * M4.1d's wedding (`rsvpScenario`) with a menu (Fish, Vegetarian with dietary notes) and, unless
 * `questions: false`, the standard RSVP questions published. Built through the commands, as a
 * host would.
 */
export async function rsvpQuestionsScenario(
  orgId: string,
  opts: { ctx?: Ctx; questions?: boolean; deadline?: Date | null } = {},
): Promise<RsvpQuestionsScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const s = await rsvpScenario(orgId, { ctx, deadline: opts.deadline ?? null });
  const subs = await executeQuery(subEventsQuery, { eventId: s.eventId }, ctx, ports);
  const ceremonyId = subs.find((x) => x.kind === 'ceremony')?.id as string;
  const receptionId = subs.find((x) => x.kind === 'reception')?.id as string;
  const list = await executeQuery(guestListQuery, { eventId: s.eventId, limit: 50 }, ctx, ports);
  const all = list.parties.flatMap((p) => p.guests);
  const id = (first: string | null, kind = 'guest') =>
    all.find((g) => g.firstName === first && g.kind === kind)?.id as string;
  const fish = await executeCommand(
    saveMenuOptionCommand,
    { eventId: s.eventId, label: 'Fish', notes: 'Contains shellfish' },
    ctx,
    ports,
  );
  const veg = await executeCommand(
    saveMenuOptionCommand,
    { eventId: s.eventId, label: 'Vegetarian', notes: 'Vegan on request' },
    ctx,
    ports,
  );
  if (opts.questions !== false)
    await executeCommand(
      publishRsvpQuestionsCommand,
      { eventId: s.eventId, definition: standardRsvpQuestions({ ceremonyId, receptionId }) },
      ctx,
      ports,
    );
  return {
    ...s,
    ceremonyId,
    receptionId,
    luis: id('Luis'),
    plus: id(null, 'plus_one'),
    ana: id('Ana'),
    mei: id('Mei'),
    fish: fish.id,
    veg: veg.id,
  };
}
