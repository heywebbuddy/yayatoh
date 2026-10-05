import { defineDataSubjectContributor, REDACT, type SubjectErasure } from '@yayatoh/platform';
import { eraseInvitationsDsarTx, invitationsDsarTx } from './dsar.ts';

/**
 * tenancy's part of a data-subject request (M6.1c): team invitations addressed to the person
 * (open ones are deleted so the emailed link stops working; accepted and revoked ones keep their
 * dates but lose the address). Memberships, users and click-wrap acceptances belong to accounts:
 * account erasure handles them (M1.14e), never an org's data-subject request.
 */
export const tenancyDataSubjects = defineDataSubjectContributor({
  module: 'tenancy',
  tables: { 'tenancy.invitations': REDACT },
  async export(tx, s, ctx) {
    return { sections: { invitations: await invitationsDsarTx(tx, s.email, ctx.now) } };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const r = await eraseInvitationsDsarTx(tx, s.email, ctx.now);
    return { erased: { 'tenancy.invitations': r.deleted + r.redacted } };
  },
});
