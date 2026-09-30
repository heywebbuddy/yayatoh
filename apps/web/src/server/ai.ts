import 'server-only';
import { type AiDrafter, drafterFromEnv } from '@yayatoh/ai';

let drafter: AiDrafter | null | undefined;

/**
 * The AI drafter for this deployment (M1.4f): the deterministic fake in dev, CI and previews;
 * the Anthropic adapter once the owner's key is configured; null (drafting off) otherwise.
 */
export function aiDrafter(): AiDrafter | null {
  if (drafter === undefined) drafter = drafterFromEnv(process.env);
  return drafter;
}
