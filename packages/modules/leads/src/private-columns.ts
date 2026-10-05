import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `leads` schema (M5.6b; roadmap §9 canary leak test). A lead is personal
 * data the exhibitor controls (P5-8): shown only to that exhibitor's licensed people through the
 * lead allowlist and to the attendee as "who scanned me" (exhibitor names and dates only), never
 * on a public page or to the organizer.
 */
export const privateColumns = columnPrivacy('leads', {
  exhibitor_settings: { qualifiers: internal() },
  leads: {
    name: personal(),
    job_title: personal(),
    company: personal(),
    email: personal('email'),
    shared_fields: 'vocab',
    rating: 'vocab',
    qualifiers: internal(),
    notes: internal(),
  },
  lead_scans: {
    scan_id: internal('none', { why: 'a device scan id (checked shape); never leaves the sync reply' }),
    result: 'vocab',
  },
});
