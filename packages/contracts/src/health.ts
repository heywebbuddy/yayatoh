import { z } from 'zod';
import { defineSerializer } from './serializer.ts';

export const HealthDto = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  time: z.iso.datetime(),
});
export type HealthDto = z.infer<typeof HealthDto>;
export const healthSerializer = defineSerializer('health', HealthDto);
