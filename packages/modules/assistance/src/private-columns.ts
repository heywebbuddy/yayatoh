import { columnPrivacy, personal } from '@yayatoh/db';

/**
 * Column privacy of the `assistance` schema (M3.3b; roadmap §9 canary leak test). What a guest
 * or staff member typed is personal: shown to the event's staff only (allowlisted DTOs), never
 * on a public page (the guest's own status link shows the state, not the note), never exported
 * for marketing.
 */
export const privateColumns = columnPrivacy('assistance', {
  requests: {
    source: 'vocab',
    reason: 'vocab',
    priority: 'vocab',
    state: 'vocab',
    note: personal(),
    location: personal(),
  },
  activity: { kind: 'vocab', body: personal() },
});
