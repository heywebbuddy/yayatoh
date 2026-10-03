import { columnPrivacy, internal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `checkin` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('checkin', {
  admissions: { day: 'vocab' },
  // Checkpoint names are staff-facing (the door manifest carries them).
  checkpoints: {
    name: internal(),
    kind: 'vocab',
    // M5.6a: the flyer's token (attendance only); staff print it, the public page never echoes it.
    self_checkin_token: secret('none', {
      why: 'CHECK requires a 32-char base64url token on a session door; only sessionAttendanceQuery (staff) returns it',
    }),
  },
  devices: {
    label: internal(),
    token_hash: secret(),
    mode: 'vocab',
    app_version: internal(),
    kiosk_pin_hash: secret('none', {
      why: 'CHECK requires the pbkdf2 format; only the kiosk device gets it (staff-mode.int.test)',
    }),
  },
  // Triage notes are staff-written (acknowledge/dismiss, M1.9e).
  fraud_signals: {
    kind: 'vocab',
    detail: internal(),
    severity: 'vocab',
    status: 'vocab',
    source: 'vocab',
    resolution_note: internal(),
  },
  // Staff push (M3.4a): the endpoint and keys are credentials of the device's browser.
  staff_push_subscriptions: {
    endpoint: secret('url'),
    p256dh: secret('none', {
      why: 'CHECK requires an 87-char base64url P-256 key; never selected into a DTO',
    }),
    auth_secret: secret('none', {
      why: 'CHECK requires a 22-char base64url secret; never selected into a DTO',
    }),
    locale: 'vocab',
    copy: internal(),
  },
  staff_alert_pushes: { alert_key: internal(), kind: 'vocab', params: internal(), status: 'vocab' },
  scans: { result: 'vocab', code_kind: 'vocab', client_scan_id: internal() },
  // M3.3a live mode: closed sets.
  device_events: { kind: 'vocab' },
  staff_presence: { source: 'vocab' },
  // M5.6a session check-in: the override reason is staff-written (audited with it).
  session_attendance: { source: 'vocab', override_gates: 'vocab', override_reason: internal() },
});
