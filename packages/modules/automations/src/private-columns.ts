import { columnPrivacy, holder, internal } from '@yayatoh/db';

/**
 * Column privacy of the `automations` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('automations', {
  // A journey's name is the organizer's working title: never public, never in a message.
  journeys: { name: internal(), trigger: 'vocab', template: 'vocab' },
  // Message copy goes to the people in the journey (like announcements); labels are the org's notes.
  journey_steps: {
    anchor: 'vocab',
    at_time: 'vocab',
    action: 'vocab',
    subject: holder(),
    body: holder(),
    label: internal(),
    condition: 'vocab',
  },
  journey_runs: { trigger: 'vocab', locale: 'vocab', status: 'vocab', reason: 'vocab' },
  scheduled_actions: {
    action: 'vocab',
    idempotency_key: internal(),
    status: 'vocab',
    outcome: 'vocab',
    last_error: internal(),
  },
});
