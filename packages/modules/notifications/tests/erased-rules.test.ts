import { describe, expect, it } from 'vitest';
import { erasedAddressAllows, erasedMailClass } from '../src/delivery-rules.ts';
import { KINDS, type MessageKind } from '../src/kinds.ts';

describe('mail to an erased address (M1.14e)', () => {
  const cls = (k: MessageKind) => erasedMailClass(k, KINDS[k]);

  it('classes every kind: order mail, account mail, org mail', () => {
    expect(cls('orders.tickets')).toBe('order');
    expect(cls('orders.refund')).toBe('order');
    expect(cls('ticketing.claim-link')).toBe('order');
    expect(cls('ticketing.holder-link')).toBe('order');
    expect(cls('seating.finder-code')).toBe('order');
    expect(cls('messaging.reply')).toBe('order');
    expect(cls('tenancy.invitation')).toBe('account');
    expect(cls('sales.order_paid')).toBe('account');
    expect(cls('payments.destination-changed')).toBe('account');
    expect(cls('events.reminder')).toBe('org');
    expect(cls('attendees.message')).toBe('org');
    expect(cls('messaging.announcement')).toBe('org');
  });

  it('lets order mail through, account mail after a new sign-up, org mail after a new consent', () => {
    const at = new Date();
    expect(erasedAddressAllows({ mailClass: 'order', accountLiftedAt: null, consentRegiven: false })).toBe(
      true,
    );
    expect(erasedAddressAllows({ mailClass: 'account', accountLiftedAt: null, consentRegiven: true })).toBe(
      false,
    );
    expect(erasedAddressAllows({ mailClass: 'account', accountLiftedAt: at, consentRegiven: false })).toBe(
      true,
    );
    expect(erasedAddressAllows({ mailClass: 'org', accountLiftedAt: at, consentRegiven: false })).toBe(false);
    expect(erasedAddressAllows({ mailClass: 'org', accountLiftedAt: null, consentRegiven: true })).toBe(true);
  });
});
