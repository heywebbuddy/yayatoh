import { defineDataSubjectContributor, notSubject, type SubjectErasure } from '@yayatoh/platform';

/**
 * alerts' part of a data-subject request (M6.1c). The only personal value is a member's own
 * mobile number for alert texts, keyed by their user id: staff settings an attendee's address can
 * never reach. Account erasure (M1.14e) removes a member; nothing here is about ticket buyers,
 * guests or contacts.
 */
export const alertsDataSubjects = defineDataSubjectContributor({
  module: 'alerts',
  tables: {
    'alerts.member_settings': notSubject(
      "a staff member's own alert-text number, keyed by user id; handled by account erasure, never reachable from an attendee's address",
    ),
  },
  export: async () => ({ sections: {} }),
  erase: async (): Promise<SubjectErasure> => ({ erased: {} }),
});
