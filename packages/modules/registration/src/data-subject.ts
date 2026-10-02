import { defineDataSubjectContributor, notSubject, type SubjectErasure } from '@yayatoh/platform';

/**
 * registration's part of a data-subject request (M6.1c): nothing about a person is stored here.
 * Registration types and admission items are the organizer's setup (an access code is handed to
 * the people who may use it); capacity claims count an order's tickets (ids and numbers only).
 */
export const registrationDataSubjects = defineDataSubjectContributor({
  module: 'registration',
  tables: {
    'registration.registration_types': notSubject(
      "the organizer's registration types; the access code is shared with whoever may use it",
    ),
  },
  async export() {
    return { sections: {} };
  },
  async erase(): Promise<SubjectErasure> {
    return { erased: {} };
  },
});
