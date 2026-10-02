import { describe, expect, it } from 'vitest';
import { type MergeValues, orderRef, renderMacro, unknownMergeFields } from '../src/domain/macros.ts';

const values: MergeValues = {
  buyer_name: 'Amina Diallo',
  buyer_email: 'amina@example.test',
  event_name: 'Lakeside Jazz Night',
  event_date: 'Oct 14, 2027, 7:00 PM',
  order_ref: 'AB12CD34',
  ticket_count: '2',
  recipient_name: 'Noor Haddad',
};

describe('support macro merge fields (M3.10c)', () => {
  it('fills every known field, with or without spaces inside the braces', () => {
    expect(
      renderMacro(
        'Hi {{buyer_name}}, your {{ ticket_count }} tickets for {{event_name}} ({{order_ref}}).',
        values,
      ),
    ).toBe('Hi Amina Diallo, your 2 tickets for Lakeside Jazz Night (AB12CD34).');
    expect(renderMacro('{{recipient_name}} now holds it; doors {{event_date}}.', values)).toBe(
      'Noor Haddad now holds it; doors Oct 14, 2027, 7:00 PM.',
    );
  });

  it('refuses unknown fields and stray braces when a macro is saved', () => {
    expect(unknownMergeFields('Hi {{buyer_name}}')).toEqual([]);
    expect(unknownMergeFields('Hi {{first_name}} and {{password}}')).toEqual(['first_name', 'password']);
    expect(unknownMergeFields('Hi {{buyer_name}')).toEqual(['{{']);
    expect(unknownMergeFields('No fields at all.')).toEqual([]);
  });

  it('never leaves a raw field in what is sent', () => {
    expect(renderMacro('A {{nope}} B', values)).toBe('A  B');
  });

  it('the order reference is the last 8 hex digits, upper case', () => {
    expect(orderRef('01928f3e-7b2a-7c11-9d0e-4f5a6b7c8d9e')).toBe('6B7C8D9E');
  });
});
