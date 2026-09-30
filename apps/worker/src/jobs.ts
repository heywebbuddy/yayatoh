import { z } from 'zod';

/** Every tenant job carries its org; the job guard rejects one without it (roadmap §4.3 step 7). */
export const TenantJobEnvelope = z.object({ orgId: z.uuid() });

export interface JobDefinition<P> {
  readonly name: string;
  /** `tenant` jobs must carry `orgId`; `platform` jobs must not touch tenant data without it. */
  readonly scope: 'tenant' | 'platform';
  readonly payload: z.ZodType<P>;
  readonly handler: (payload: P, meta: { id: string; name: string }) => Promise<void>;
  readonly retryLimit?: number;
  /**
   * pg-boss queue policy. `exclusive`: at most one job per `singletonKey` queued or active (a
   * resumable batch is worked by one job at a time). Default `standard`.
   */
  readonly policy?: 'standard' | 'exclusive';
}

export function defineJob<P>(def: JobDefinition<P>): JobDefinition<P> {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(def.name)) {
    throw new Error(`Job name must be dotted lowercase, e.g. "platform.heartbeat": ${def.name}`);
  }
  return def;
}

/** Validate a job payload before its handler runs. Throws so pg-boss records the failure. */
export function parseJobPayload<P>(job: JobDefinition<P>, data: unknown): P {
  if (job.scope === 'tenant') {
    const env = TenantJobEnvelope.safeParse(data);
    if (!env.success) throw new Error(`job guard: tenant job ${job.name} is missing a valid orgId`);
  }
  return job.payload.parse(data);
}
