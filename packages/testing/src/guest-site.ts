import {
  addGuestSiteBlockCommand,
  guestSiteQuery,
  publishGuestSiteCommand,
  saveGuestSiteCommand,
  setGuestSitePasswordCommand,
  subEventsQuery,
  updateGuestSiteBlockCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { ports } from './ports.ts';
import { type RsvpScenario, rsvpScenario } from './rsvp.ts';

export const GUEST_SITE_PASSWORD = 'Lake House';

export interface GuestSiteScenario extends RsvpScenario {
  /** The site's address code (`/w/{code}`). */
  readonly code: string;
  readonly password: string;
  readonly title: string;
}

/**
 * M4.5a e2e/integration data: the M4.1d wedding (a ceremony for everyone, a reception for Luis
 * only) with a guest website: an intro, a welcome text, the program (sub-events everyone is
 * invited to), travel, a registry link and an FAQ; password `Lake House`; published unless asked.
 */
export async function guestSiteScenario(
  orgId: string,
  opts: { publish?: boolean; ctx?: Ctx } = {},
): Promise<GuestSiteScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const w = await rsvpScenario(orgId, { ctx });
  const ev = { eventId: w.eventId };
  const title = 'Ana & Luis';
  await executeCommand(
    saveGuestSiteCommand,
    { ...ev, title, intro: 'We can’t wait to celebrate with you.', contentLocale: 'en' },
    ctx,
    ports,
  );
  const block = async (kind: 'text' | 'program' | 'travel' | 'registry' | 'faq', heading: string, content: unknown) => {
    const b = await executeCommand(addGuestSiteBlockCommand, { ...ev, kind }, ctx, ports);
    await executeCommand(updateGuestSiteBlockCommand, { ...ev, blockId: b.id, heading, content }, ctx, ports);
  };
  await block('text', 'Welcome', { body: 'Join us by the **lake** in June.' });
  await block('program', 'The day', { show: 'everyone', subEventIds: [] });
  await block('travel', 'Getting there', {
    items: [{ title: 'Lakeside Inn', details: 'Ask for the wedding rate.', url: 'https://inn.example.test/' }],
  });
  await block('registry', 'Registry', {
    items: [{ label: 'Our gift list', url: 'https://gifts.example.test/ana-luis' }],
  });
  await block('faq', 'Questions', { items: [{ question: 'Can I bring my kids?', answer: 'Yes, of course.' }] });
  await executeCommand(setGuestSitePasswordCommand, { ...ev, password: GUEST_SITE_PASSWORD }, ctx, ports);
  if (opts.publish ?? true) await executeCommand(publishGuestSiteCommand, { ...ev, published: true }, ctx, ports);
  const site = await executeQuery(guestSiteQuery, ev, ctx, ports);
  if (!site.code) throw new Error('guestSiteScenario: no site code');
  // Sanity: the scenario's reception is for Luis only, so "everyone" leaves it out.
  const subs = await executeQuery(subEventsQuery, ev, ctx, ports);
  if (!subs.some((s) => !s.inviteAll)) throw new Error('guestSiteScenario: expected a private sub-event');
  return { ...w, code: site.code, password: GUEST_SITE_PASSWORD, title };
}
