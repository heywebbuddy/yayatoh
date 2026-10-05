import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  type SubjectErasure,
  type SubjectExport,
} from '@yayatoh/platform';
import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import { identities, scimGroupMembers, scimGroups, scimUsers } from './schema.ts';

/** The SCIM users the org's IdP provisioned with this address (as userName or email). */
async function scimUsersTx(tx: TenantTx, s: DataSubject) {
  return tx
    .select()
    .from(scimUsers)
    .where(or(sql`lower(${scimUsers.email}) = ${s.email}`, sql`lower(${scimUsers.userName}) = ${s.email}`))
    .orderBy(asc(scimUsers.createdAt));
}

/**
 * sso's part of a data-subject request (M6.5a, M6.1c). What the org's IdP sent about the person
 * (their SCIM user and group memberships) and the IdP identity links of that account are exported
 * and deleted (the IdP provisions them again if it still should). The account itself is the
 * person's own (M1.14e).
 */
export const ssoDataSubjects = defineDataSubjectContributor({
  module: 'sso',
  tables: {
    'sso.scim_users': DELETE,
    'sso.identities': DELETE,
  },
  async export(tx, s): Promise<SubjectExport> {
    const users = await scimUsersTx(tx, s);
    if (users.length === 0) return { sections: {} };
    const ids = users.map((u) => u.id);
    const groups = await tx
      .select({ user: scimGroupMembers.scimUserId, group: scimGroups.displayName })
      .from(scimGroupMembers)
      .innerJoin(scimGroups, eq(scimGroups.id, scimGroupMembers.groupId))
      .where(inArray(scimGroupMembers.scimUserId, ids));
    const links = await tx
      .select({
        subject: identities.subject,
        lastSignInAt: identities.lastSignInAt,
        createdAt: identities.createdAt,
      })
      .from(identities)
      .where(
        inArray(
          identities.userId,
          users.map((u) => u.userId),
        ),
      );
    return {
      sections: {
        scimUsers: users.map((u) => ({
          userName: u.userName,
          email: u.email,
          externalId: u.externalId,
          displayName: u.displayName,
          givenName: u.givenName,
          familyName: u.familyName,
          active: u.active,
          createdAt: u.createdAt,
          deprovisionedAt: u.deprovisionedAt,
          groups: groups.filter((g) => g.user === u.id).map((g) => g.group),
        })),
        identities: links,
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const users = await scimUsersTx(tx, s);
    if (users.length === 0) return { erased: {} };
    const links = await tx
      .delete(identities)
      .where(
        inArray(
          identities.userId,
          users.map((u) => u.userId),
        ),
      )
      .returning({ id: identities.id });
    const gone = await tx
      .delete(scimUsers)
      .where(
        inArray(
          scimUsers.id,
          users.map((u) => u.id),
        ),
      )
      .returning({ id: scimUsers.id });
    return { erased: { 'sso.scim_users': gone.length, 'sso.identities': links.length } };
  },
});
