import { catchUpSubscriber, defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { z } from 'zod';
import { mediaStore } from './storage/config.ts';

const Payload = z.object({ mediaAssets: z.array(z.uuid()).max(10_000) });

/**
 * M6.1c: a data-subject erasure deleted rows that named stored files (uploads, photos, earlier
 * access archives); the files themselves live in the object store, outside the transaction, so
 * they go here, after the erasure committed (`privacy.subject_erased@1`). The store is
 * idempotent: a replay only repeats the purge. The event carries asset ids only.
 */
export function subjectErasedMediaCleaner(): Subscriber {
  return defineSubscriber({
    name: 'media.subject-erased-cleanup',
    events: ['privacy.subject_erased@1'],
    handle: async (_tx, event) => {
      const p = Payload.parse(event.payload);
      for (const id of p.mediaAssets) await mediaStore().deleteAsset(event.orgId, id);
    },
  });
}

/** Apply the org's pending erasure file deletions now (the web right after an erasure; tests). */
export function catchUpErasedMedia(orgId: string): Promise<number> {
  return catchUpSubscriber(subjectErasedMediaCleaner(), orgId);
}
