import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  defineDataSubjectContributor,
  ERASED_NAME,
  REDACT,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { items, uploaders } from './schema.ts';

/**
 * The person's full names (first and last: at least two words) as other modules resolved them.
 * A guest uploader is only the name they typed on the guest site; a single word ("Sam") would
 * match other guests and is never used.
 */
const fullNames = (s: DataSubject) => [
  ...new Set(
    refsOf(s, 'name')
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n !== ERASED_NAME.toLowerCase() && /\S\s+\S/.test(n)),
  ),
];

async function uploaderRowsTx(tx: TenantTx, s: DataSubject) {
  const names = fullNames(s);
  if (names.length === 0) return [];
  return tx
    .select()
    .from(uploaders)
    .where(and(eq(uploaders.kind, 'guest'), inArray(sql`lower(btrim(${uploaders.displayName}))`, names)))
    .orderBy(asc(uploaders.createdAt));
}

/**
 * gallery's part of a data-subject request (M4.5b, wired at the batch 3u merge). Guest uploaders
 * signed with the person's full name: their name and the captions of what they uploaded are
 * exported; on erasure the uploader shows as "Erased" and the captions go. The photos stay in the
 * host's event gallery (the host moderates and removes them; removing deletes the files). Host
 * uploaders are members (tenancy covers them); settings and variants hold nothing about a person.
 */
export const galleryDataSubjects = defineDataSubjectContributor({
  module: 'gallery',
  tables: {
    'gallery.uploaders': REDACT,
    'gallery.items': REDACT,
  },
  async export(tx, s) {
    const people = await uploaderRowsTx(tx, s);
    const uploaded = people.length
      ? await tx
          .select()
          .from(items)
          .where(
            inArray(
              items.uploaderId,
              people.map((u) => u.id),
            ),
          )
          .orderBy(asc(items.createdAt))
      : [];
    return {
      sections: {
        uploaders: people.map((u) => ({ eventId: u.eventId, displayName: u.displayName })),
        uploads: uploaded.map((i) => ({
          eventId: i.eventId,
          kind: i.kind,
          status: i.status,
          caption: i.caption,
          videoProvider: i.videoProvider,
          videoId: i.videoId,
          uploadedAt: i.createdAt,
          publishedAt: i.publishedAt,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const ids = (await uploaderRowsTx(tx, s)).map((u) => u.id);
    if (ids.length === 0) return { erased: {} };
    const captions = await tx
      .update(items)
      .set({ caption: null, updatedAt: ctx.now })
      .where(and(inArray(items.uploaderId, ids), sql`${items.caption} is not null`))
      .returning({ id: items.id });
    const people = await tx
      .update(uploaders)
      .set({ displayName: ERASED_NAME, updatedAt: ctx.now })
      .where(inArray(uploaders.id, ids))
      .returning({ id: uploaders.id });
    return { erased: { 'gallery.uploaders': people.length, 'gallery.items': captions.length } };
  },
});
