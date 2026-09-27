/**
 * The platform's own agreements, accepted by organizers with a click-wrap (M1.3). DRAFTS: the
 * final wording comes from counsel (owner inbox), and changing it means bumping the version in
 * @yayatoh/tenancy PLATFORM_AGREEMENTS so every organization accepts again. English only until
 * counsel provides translations.
 */
export const PLATFORM_LEGAL: Record<'platform_tos' | 'dpa', { title: string; body: string }> = {
  platform_tos: {
    title: 'Yayatoh Terms of Service for organizers (draft)',
    body: [
      'DRAFT — not the final text. Counsel is preparing the Terms of Service; this placeholder lets the product record who accepted which version.',
      'By accepting, the person clicking confirms they may bind the organization, and the organization agrees to use Yayatoh to run events lawfully, to be responsible for its events and for the information it gives attendees, and to follow the payment, refund and fee terms shown at checkout.',
    ].join('\n\n'),
  },
  dpa: {
    title: 'Yayatoh Data Processing Addendum (draft)',
    body: [
      'DRAFT — not the final text. Counsel is preparing the Data Processing Addendum.',
      'Yayatoh processes attendee personal data on the organization’s instructions to run its events: registrations, tickets, check-in and messages. Data stays within the organization’s account, is protected with the safeguards described in the security documentation, and is deleted or returned when the organization closes its account.',
    ].join('\n\n'),
  },
};
