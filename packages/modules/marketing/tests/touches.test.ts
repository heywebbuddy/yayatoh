import { describe, expect, it } from 'vitest';
import { clickPath, landingKind, MAX_TOUCHES, REFERRAL_MEDIUM, referralUtm } from '../src/index.ts';

const click = (n: number) => ({
  clickId: `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  linkId: 'l',
  eventId: 'e',
  clickedAt: new Date(Date.UTC(2027, 0, 1, 0, n)),
});

describe('touch paths (M6.2b)', () => {
  it('orders clicks in time (ties by id) and keeps the first and the latest ones', () => {
    const tie = { ...click(5), clickId: '01900000-0000-7000-8000-000000000000' };
    expect(clickPath([click(5), click(1), tie]).map((c) => c.clickId)).toEqual([
      click(1).clickId,
      tie.clickId,
      click(5).clickId,
    ]);
    const many = Array.from({ length: 80 }, (_, i) => click(i));
    const path = clickPath(many);
    expect(path).toHaveLength(MAX_TOUCHES);
    expect(path[0]?.clickId).toBe(click(0).clickId);
    expect(path[1]?.clickId).toBe(click(80 - (MAX_TOUCHES - 1)).clickId);
    expect(path.at(-1)?.clickId).toBe(click(79).clickId);
  });

  it('landing kinds: referral = medium referral without a campaign', () => {
    expect(landingKind({ medium: REFERRAL_MEDIUM, campaign: null })).toBe('referral');
    expect(landingKind({ medium: REFERRAL_MEDIUM, campaign: 'spring' })).toBe('utm');
    expect(landingKind({ medium: 'email', campaign: null })).toBe('utm');
  });

  it('referrals: another site by host only; never our own hosts or payment pages', () => {
    expect(referralUtm('https://www.Blog.example/posts/1?email=a@b.c', 'tickets.lakeside.test')).toEqual({
      source: 'blog.example',
      medium: 'referral',
      campaign: null,
      content: null,
      term: null,
    });
    expect(referralUtm('https://www.google.com/', 'yayatoh.com')?.source).toBe('google.com');
    expect(referralUtm('https://yayatoh.com/e/x', 'yayatoh.com')).toBeNull();
    expect(referralUtm('https://abc.yayatoh.com/e/x', 'yayatoh.com')).toBeNull();
    expect(referralUtm('https://yayatoh.com/', 'abc.yayatoh.com:3000')).toBeNull();
    expect(referralUtm('https://checkout.stripe.com/c/pay', 'yayatoh.com')).toBeNull();
    expect(referralUtm('https://www.paypal.com/x', 'yayatoh.com')).toBeNull();
    expect(referralUtm('android-app://com.slack', 'yayatoh.com')).toBeNull();
    expect(referralUtm('not a url', 'yayatoh.com')).toBeNull();
    expect(referralUtm(null, 'yayatoh.com')).toBeNull();
    expect(referralUtm(`https://${'a'.repeat(2100)}.com`, 'yayatoh.com')).toBeNull();
  });
});
