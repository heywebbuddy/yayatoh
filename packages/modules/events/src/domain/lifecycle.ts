import { defineStateMachine } from '@yayatoh/kernel';
import { EVENT_STATUSES } from '../schema.ts';

/** Event lifecycle (roadmap §5.1: draft/published/postponed/cancelled/completed/archived). */
export const eventLifecycle = defineStateMachine({
  name: 'event',
  states: EVENT_STATUSES,
  initial: 'draft',
  events: {
    publish: { from: ['draft'], to: 'published' },
    unpublish: { from: ['published'], to: 'draft' },
    postpone: { from: ['published'], to: 'postponed' },
    reschedule: { from: ['postponed'], to: 'published' },
    cancel: { from: ['draft', 'published', 'postponed'], to: 'cancelled' },
    complete: { from: ['published'], to: 'completed' },
    archive: { from: ['completed', 'cancelled'], to: 'archived' },
  },
});

export type EventTransition = keyof typeof eventLifecycle.events;
export const EVENT_TRANSITIONS = Object.keys(eventLifecycle.events) as EventTransition[];

/** Turn a name into a URL slug (ASCII, lowercase, hyphenated). Callers ensure uniqueness. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s.length >= 2 ? s : `event-${s}`.replace(/-$/, '');
}
