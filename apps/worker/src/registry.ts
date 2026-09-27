import type { Subscriber } from '@yayatoh/platform';
import { z } from 'zod';
import { defineJob } from './jobs.ts';

export const heartbeat = defineJob({
  name: 'platform.heartbeat',
  scope: 'platform',
  payload: z.object({ at: z.iso.datetime() }),
  handler: async () => {},
});

/** Composition root for jobs and event subscribers. Modules register theirs here as they land. */
export const JOBS = [heartbeat] as const;
export const SUBSCRIBERS: readonly Subscriber[] = [];
