import { columnPrivacy, holder, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `ce` schema (roadmap §9 canary leak test). The credit label and the
 * accreditor are the organizer's own words printed on certificates. The holder's name and address
 * reach the holder (certificate, email) and event editors only; the public verification page
 * shows a masked name (first name and an initial), never the stored one.
 */
export const privateColumns = columnPrivacy('ce', {
  settings: { credit_label: 'public', accreditor: 'public' },
  certificates: {
    // Printed on the holder's certificate and checked on the verification page by whoever has it.
    code: holder('none', {
      why: 'CHECK allows Crockford codes only; reaches the holder in their PDF and email.',
    }),
    holder_name: personal(),
    holder_email: personal('email'),
    locale: 'vocab',
    content_hash: internal('none', { why: 'A sha256 of the awards (CHECK: 64 hex digits); never shown.' }),
    status: 'vocab',
    copy_version: 'vocab',
  },
});
