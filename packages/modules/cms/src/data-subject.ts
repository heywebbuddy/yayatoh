import {
  DELETE,
  defineDataSubjectContributor,
  notSubject,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, sql } from 'drizzle-orm';
import { contactRequests } from './schema.ts';

/** The stored address, matched like the normalized one (it is kept as typed). */
const byEmail = (email: string) => sql`lower(btrim(${contactRequests.email})) = ${email}`;

/**
 * cms's part of a data-subject request (M3.11b, M6.1c). Contact and sales requests the person
 * sent from the marketplace contact page are deleted. Entries' `author_name` is the byline of the
 * member who wrote a page or post (`author_user_id`): staff are erased through their account
 * (keyed by user id), and matching bylines by a name an attendee happens to share would erase
 * another person's byline.
 */
export const cmsDataSubjects = defineDataSubjectContributor({
  module: 'cms',
  tables: {
    'cms.contact_requests': DELETE,
    'cms.entries': notSubject(
      'author_name is the byline of the org member who wrote the page or post (author_user_id), erased with their account',
    ),
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await tx
      .select({ name: contactRequests.name })
      .from(contactRequests)
      .where(byEmail(s.email));
    return rows.length ? { name: rows.map((r) => r.name) } : {};
  },
  async export(tx, s): Promise<SubjectExport> {
    const rows = await tx
      .select({
        topic: contactRequests.topic,
        name: contactRequests.name,
        email: contactRequests.email,
        company: contactRequests.company,
        message: contactRequests.message,
        locale: contactRequests.locale,
        status: contactRequests.status,
        sentAt: contactRequests.createdAt,
      })
      .from(contactRequests)
      .where(byEmail(s.email))
      .orderBy(asc(contactRequests.createdAt));
    return { sections: { contactRequests: rows } };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const gone = await tx
      .delete(contactRequests)
      .where(byEmail(s.email))
      .returning({ id: contactRequests.id });
    return { erased: { 'cms.contact_requests': gone.length } };
  },
});
