import { z } from 'zod';
import { defineJob } from './jobs.ts';

export const heartbeat = defineJob({
  name: 'platform.heartbeat',
  scope: 'platform',
  payload: z.object({ at: z.iso.datetime() }),
  handler: async () => {},
});

/** Composition root for jobs. Modules register theirs here as they land. */
export const JOBS = [heartbeat] as const;
