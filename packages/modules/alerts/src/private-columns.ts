import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `alerts` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('alerts', {
  // Rule keys, groups, severities and states are fixed vocabularies; `params` holds numbers only.
  alerts: {
    rule: 'vocab',
    scope_key: internal('none', {
      why: 'the event id, "org" or "m:{rule id}" (M6.2b) by CHECK constraint; no free text',
    }),
    category: 'vocab',
    severity: 'vocab',
    state: 'vocab',
    params: internal(),
    // M6.2b: an organizer rule's name (console-only).
    title: internal(),
  },
  alert_history: { action: 'vocab', state: 'vocab' },
  signals: { kind: 'vocab' },
  routing: { role: 'vocab', category: 'vocab', channels: 'vocab' },
  // A member's own mobile number for alert texts: never shown to anyone else or on public output.
  member_settings: { sms_phone: personal('phone') },
});
