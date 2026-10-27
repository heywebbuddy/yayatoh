import { withTenant } from '@yayatoh/db';
import { type EventTarget, findEventTx, publicEventBySlug } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { askAssistantAction } from '@/app/[locale]/events/[slug]/assistant-actions.ts';
import { aiDrafter } from '@/server/ai.ts';
import { EventAssistant } from './event-assistant.tsx';

/**
 * The assistant for a ticket-holder page (the attendee portal): shown only when the organizer
 * turned it on for the event and an AI provider is configured. The event comes from the page's
 * verified target, the slug from the event itself.
 */
export async function HolderAssistant({ target }: { target: EventTarget }) {
  if (!aiDrafter()) return null;
  const ev = await withTenant(
    createCtx({ orgId: target.orgId, actor: { type: 'system', name: 'assistant.portal' } }),
    (tx) => findEventTx(tx, target.eventId),
  );
  if (!ev) return null;
  const pub = await publicEventBySlug(ev.slug);
  if (!pub?.design.assistant) return null;
  return (
    <EventAssistant slug={ev.slug} ask={askAssistantAction} helpHref={`/events/${ev.slug}/seat-finder`} />
  );
}
