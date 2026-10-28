import { describe, expect, it } from 'vitest';
import { defaultDecisionEmail, invitationEmail, renderPlainEmail } from '../src/domain/email.ts';
import { APPLICATION_STATUSES, ApplicationInput, canTransition, nextStatuses } from '../src/domain/rules.ts';

const valid = {
  kind: 'apply',
  orgName: 'Harbor Weddings',
  orgType: 'company',
  country: 'in',
  website: 'https://harbor.example',
  contactName: 'Asha Rao',
  contactEmail: ' Asha@Harbor.Example ',
  contactPhone: '',
  eventTypes: ['wedding', 'gala'],
  eventsPerYear: '6-20',
  expectedTickets: '500-5000',
  planInterest: 'pro',
  whiteLabel: true,
  message: '',
  locale: 'en',
};

describe('application input', () => {
  it('normalizes the country and email and drops blank optional fields', () => {
    const v = ApplicationInput.parse(valid);
    expect(v.country).toBe('IN');
    expect(v.contactEmail).toBe('asha@harbor.example');
    expect(v.contactPhone).toBeUndefined();
    expect(v.message).toBeUndefined();
  });

  it('refuses bad shapes', () => {
    for (const bad of [
      { ...valid, orgName: 'x' },
      { ...valid, contactEmail: 'not-an-email' },
      { ...valid, country: 'India' },
      { ...valid, website: 'javascript:alert(1)' },
      { ...valid, eventTypes: [] },
      { ...valid, eventTypes: ['rave'] },
      { ...valid, planInterest: 'free' },
      { ...valid, message: 'x'.repeat(2001) },
    ])
      expect(ApplicationInput.safeParse(bad).success).toBe(false);
  });

  it('a demo needs a preferred time', () => {
    expect(ApplicationInput.safeParse({ ...valid, kind: 'demo' }).success).toBe(false);
    expect(
      ApplicationInput.safeParse({ ...valid, kind: 'demo', preferredTime: '2027-02-01T10:00:00+05:30' })
        .success,
    ).toBe(true);
  });
});

describe('status machine', () => {
  it('approved is final, rejected can only be reopened', () => {
    expect(nextStatuses('approved')).toEqual([]);
    expect(nextStatuses('rejected')).toEqual(['in_review']);
    expect(canTransition('new', 'approved')).toBe(true);
    expect(canTransition('needs_info', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'new')).toBe(false);
  });

  it('no status goes back to new and none goes to itself', () => {
    for (const s of APPLICATION_STATUSES) {
      expect(canTransition(s, 'new')).toBe(false);
      expect(canTransition(s, s)).toBe(false);
    }
  });
});

describe('emails', () => {
  it('escapes staff text and only links http(s) addresses', () => {
    const m = renderPlainEmail({
      subject: 'Hi',
      body: 'A <b>bold</b> move & "more"\n\nSecond',
      cta: { label: 'Go', url: 'https://yayatoh.com/signup?code=X' },
    });
    expect(m.html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(m.html).toContain('href="https://yayatoh.com/signup?code=X"');
    expect(m.text).toContain('Go: https://yayatoh.com/signup?code=X');
    const bad = renderPlainEmail({
      subject: 'x',
      body: 'y',
      cta: { label: 'Go', url: 'javascript:alert(1)' },
    });
    expect(bad.html).not.toContain('href=');
    expect(bad.text).not.toContain('javascript');
  });

  it('the defaults name the applicant and are editable text', () => {
    const a = { contactName: 'Asha Rao', orgName: 'Harbor Weddings' };
    expect(defaultDecisionEmail('needs_info', a).body).toContain('Hi Asha');
    expect(defaultDecisionEmail('rejected', a).subject).toContain('Harbor Weddings');
    const inv = invitationEmail(
      { ...a, plan: 'pro', planName: 'Pro', days: 14 },
      'https://x.test/signup?code=A',
    );
    expect(inv.cta?.url).toBe('https://x.test/signup?code=A');
    expect(inv.body).toContain('Pro plan');
  });
});
