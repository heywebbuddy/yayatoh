import { describe, expect, it } from 'vitest';
import { type CartFacts, returnUrls, WEB_REASONS, webCheckoutUrl, webReasonOf } from '../src/app-checkout.ts';

const none: CartFacts = {
  streaming: [],
  seated: [],
  transferFee: [],
  chooseAmount: [],
  registration: false,
  questions: false,
};

describe('which carts the app finishes (M7.2f, P7-7)', () => {
  it('a plain cart is bought in the app', () => {
    expect(webReasonOf(none)).toBeNull();
  });

  it('each thing the app cannot do names its reason', () => {
    expect(webReasonOf({ ...none, questions: true })).toBe('checkout_questions');
    expect(webReasonOf({ ...none, seated: ['t1'] })).toBe('seat_selection');
    expect(webReasonOf({ ...none, registration: true })).toBe('registration');
    expect(webReasonOf({ ...none, transferFee: ['t1'] })).toBe('transfer_fee');
    expect(webReasonOf({ ...none, chooseAmount: ['t1'] })).toBe('choose_your_amount');
  });

  it('several reasons give the first in a fixed order, and every reason can be reached', () => {
    expect(webReasonOf({ ...none, questions: true, seated: ['t1'], registration: true })).toBe(
      'registration',
    );
    expect(webReasonOf({ ...none, questions: true, seated: ['t1'] })).toBe('seat_selection');
    expect(webReasonOf({ ...none, questions: true, transferFee: ['t1'], chooseAmount: ['t1'] })).toBe(
      'checkout_questions',
    );
    const reached = new Set([
      webReasonOf({ ...none, questions: true }),
      webReasonOf({ ...none, seated: ['t'] }),
      webReasonOf({ ...none, registration: true }),
      webReasonOf({ ...none, transferFee: ['t'] }),
      webReasonOf({ ...none, chooseAmount: ['t'] }),
    ]);
    expect([...reached].sort()).toEqual([...WEB_REASONS].sort());
  });
});

describe('links', () => {
  it('the web checkout is the event page, tracked as a visit from the app', () => {
    expect(webCheckoutUrl('https://app.yayatoh.com', 'jazz-night')).toBe(
      'https://app.yayatoh.com/events/jazz-night?utm_source=yayatoh-app&utm_medium=app',
    );
    expect(webCheckoutUrl('https://app.yayatoh.com/', 'jazz-night', 'abc')).toBe(
      'https://app.yayatoh.com/events/jazz-night?utm_source=yayatoh-app&utm_medium=app&date=abc',
    );
  });

  it('the payment page returns to universal links the app claims (`/events/*`), without any secret', () => {
    const { returnUrl, cancelUrl } = returnUrls('https://app.yayatoh.com', 'jazz-night', 'order-1');
    expect(returnUrl).toBe('https://app.yayatoh.com/events/jazz-night?checkout=return&order=order-1');
    expect(cancelUrl).toBe('https://app.yayatoh.com/events/jazz-night?checkout=cancelled&order=order-1');
  });
});
