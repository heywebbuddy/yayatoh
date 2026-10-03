import { z } from 'zod';

/**
 * A match as the console and the room's screens show it (P4-13: no sponsor contact; the sponsor
 * only by the public name they gave, or none). The live screen (M4.8d) takes the same shape.
 */
export const LiveMatchDto = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  publicName: z.string().nullable(),
  ratioPercent: z.int(),
  capMinor: z.int(),
  currency: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  phase: z.enum(['scheduled', 'live', 'ended']),
  matchedMinor: z.int(),
  remainingMinor: z.int(),
});
export type LiveMatchDto = z.infer<typeof LiveMatchDto>;
