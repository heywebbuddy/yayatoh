import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_NAME,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { items, uploaders } from './schema.ts';

/**
 * The person's full names (at least two words) as other modules resolved them. A guest uploads
 * behind the site's password under the name they type, with no address: the name is the only
 * link, and a single word ("Sam") would match other people, so it is never used.
 */
const fullNames = (s: DataSubject) => [
  ...new Set(
    refsOf(s, 'name')
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n !== ERASED_NAME.toLowerCase() && /\S\s+\S/.test(n)),
  ),
];

async function guestUploadersTx(tx: TenantTx, s: DataSubject) {
  const names = fullNames(s);
  if (names.length === 0) return [];
  return tx
    .select()
    .from(uploaders)
    .where(and(eq(uploaders.kind, 'guest'), inArray(sql`lower(btrim(${uploaders.displayName}))`, names)))
    .orderBy(asc(uploaders.createdAt));
}

/**
 * gallery's part of a data-subject request (M6.1c, for M4.5b; batch 3j merge). Guests' uploads
 * under the person's full name: exported (name, captions, kind, state, video links) and, on
 * erasure, deleted with their files' records (the signed file links stop at once; the photo was
 * theirs to give). Host uploads are the organizer's.
 */
export const galleryDataSubjects = defineDataSubjectContributor({
  module: 'gallery',
  tables: {
    'gallery.uploaders': DELETE,
    'gallery.items': DELETE,
  },
  async export(tx, s) {
    const who = await guestUploadersTx(tx, s);
    const ids = who.map((u) => u.id);
    const theirs = ids.length
      ? await tx.select().from(items).where(inArray(items.uploaderId, ids)).orderBy(asc(items.createdAt))
      : [];
    return {
      sections: {
        uploaders: who.map((u) => ({
          eventId: u.eventId,
          displayName: u.displayName,
          createdAt: u.createdAt,
        })),
        items: theirs.map((i) => ({
          eventId: i.eventId,
          kind: i.kind,
          status: i.status,
          caption: i.caption,
          videoProvider: i.videoProvider,
          videoId: i.videoId,
          createdAt: i.createdAt,
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const ids = (await guestUploadersTx(tx, s)).map((u) => u.id);
    if (ids.length === 0) return { erased: { 'gallery.uploaders': 0, 'gallery.items': 0 } };
    const gone = await tx.delete(items).where(inArray(items.uploaderId, ids)).returning({ id: items.id });
    const people = await tx
      .delete(uploaders)
      .where(inArray(uploaders.id, ids))
      .returning({ id: uploaders.id });
    return { erased: { 'gallery.uploaders': people.length, 'gallery.items': gone.length } };
  },
});
