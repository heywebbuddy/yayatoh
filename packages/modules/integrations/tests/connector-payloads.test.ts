import { describe, expect, it } from 'vitest';
import { CONNECTORS } from '../src/index.ts';

/**
 * M6.x: no connector payload carries PII beyond its documented set. The sets below are what each
 * connector's push side may send out of Yayatoh (docs/runbooks/connectors.md, "What leaves").
 * Adding a field to a push mapping is a privacy decision: it fails here until the set (and the
 * runbook) say so. Pull-only objects send nothing, so they are listed with an empty set.
 */
const DOCUMENTED_PUSH: Record<string, string[]> = {
  'demo.contacts': ['email', 'name'],
  'google_sheets.attendees': ['name', 'email', 'labels', 'status'],
  'salesforce.contacts': ['email', 'first_name', 'last_name'],
  'salesforce.leads': ['email', 'first_name', 'last_name', 'company'],
  'salesforce.campaigns': ['name', 'start_date', 'end_date', 'stage'],
  'salesforce.campaign_members': ['status'],
  'salesforce.sponsor_opportunities': ['name', 'stage', 'close_date', 'amount', 'tier'],
  'google_calendar.sessions': ['title', 'description', 'room', 'starts_at', 'ends_at', 'time_zone'],
  'google_calendar_personal.sessions': ['title', 'description', 'room', 'starts_at', 'ends_at', 'time_zone'],
  'zoom.registrants': ['webinar_id', 'email', 'first_name', 'last_name'],
  'mailchimp.members': ['email', 'first_name', 'last_name'],
  'hubspot.contacts': ['email', 'first_name', 'last_name', 'company'],
  'hubspot.marketing_events': ['name', 'starts_at', 'ends_at', 'venue', 'cancelled'],
  'hubspot.event_attendance': ['email'],
  'klaviyo.members': ['email', 'first_name', 'last_name', 'company'],
};

/** Never leave in any connector payload, whatever the set says. */
const NEVER = /phone|address|birth|dob|tax|bank|iban|card|payment|password|token|secret|note|ssn|gender/i;

describe('connector push payloads', () => {
  const pushes = CONNECTORS.flatMap((c) =>
    c.objects.flatMap((o) => (o.push ? [{ id: `${c.key}.${o.key}`, side: o.push }] : [])),
  );

  it('every push side has a documented field set, and every documented set exists', () => {
    expect(pushes.map((p) => p.id).sort()).toEqual(Object.keys(DOCUMENTED_PUSH).sort());
  });

  it.each(pushes)('$id sends only its documented fields by default', ({ id, side }) => {
    const sources = side.defaultMapping.map((r) => ('source' in r ? String(r.source) : '')).filter(Boolean);
    for (const s of sources) {
      expect(DOCUMENTED_PUSH[id], `${id} maps an undocumented field: ${s}`).toContain(s);
      expect(s).not.toMatch(NEVER);
    }
  });

  it('contact-bearing connectors never map the phone (it stays a pull-side field)', () => {
    for (const { id, side } of pushes)
      expect(
        side.defaultMapping.map((r) => ('source' in r ? String(r.source) : '')),
        id,
      ).not.toContain('phone');
  });

  it('pull-only objects (Eventbrite, Zoom participants) have no push side', () => {
    for (const c of CONNECTORS.filter((x) => x.key === 'eventbrite'))
      for (const o of c.objects) expect(o.push, `${c.key}.${o.key}`).toBeUndefined();
  });
});
