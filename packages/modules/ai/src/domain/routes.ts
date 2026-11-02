import type { AiPurpose } from './ledger.ts';

/** The models a route may name, with Anthropic's list prices in US dollars per million tokens. */
export const MODEL_PRICES = {
  'claude-opus-5-5': { input: 4, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheRead: 0.2, output: 10 },
  // Haiku's cache read price is an assumption (a tenth of input); no route caches yet.
  'claude-haiku-5-5': { input: 0.1, cacheRead: 0.01, output: 0.5 },
} as const;
export type RouteModel = keyof typeof MODEL_PRICES;

export interface AiRoute {
  readonly model: RouteModel;
  readonly effort: 'low' | 'medium' | 'high';
  readonly maxTokens: number;
}

const OPUS_LOW: AiRoute = { model: 'claude-opus-5-5', effort: 'low', maxTokens: 8000 };
const SONNET_LOW: AiRoute = { model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 4000 };

/**
 * AI1: which model serves each purpose. A row changes only when the evals say the cheaper model
 * holds (`evals/README.md`). `AI_MODEL` overrides every row, as an emergency switch.
 */
export const AI_ROUTES: Readonly<Record<AiPurpose, AiRoute>> = {
  tagline: OPUS_LOW,
  description: OPUS_LOW,
  faq: OPUS_LOW,
  campaign: OPUS_LOW,
  page: OPUS_LOW,
  agenda: OPUS_LOW,
  audience: OPUS_LOW,
  event_setup: OPUS_LOW,
  assistant: OPUS_LOW,
  // Not a text model: `embed` throws until an embeddings provider is chosen, so nothing is sent.
  embedding: OPUS_LOW,
  insights: { model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 2000 },
  support_assist: SONNET_LOW,
  help_answer: SONNET_LOW,
  translate: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 8000 },
};

/** Haiku has no server-side refusal fallback: a refusal is unusable output, and is refunded. */
export const hasRefusalFallback = (model: string) => !model.startsWith('claude-haiku');

/** The provider's list cost of a call, in millionths of a dollar. Unknown models cost 0. */
export function costMicros(
  model: string,
  usage: { readonly input: number; readonly cacheRead: number; readonly output: number },
): number {
  const price = MODEL_PRICES[model as RouteModel];
  if (!price) return 0;
  return Math.round(
    usage.input * price.input + usage.cacheRead * price.cacheRead + usage.output * price.output,
  );
}

/** `AI_DISABLED_PURPOSES`: purposes switched off with an environment change (the kill switch). */
export function purposeDisabled(purpose: AiPurpose, setting: string | undefined): boolean {
  if (!setting) return false;
  return setting
    .split(',')
    .map((s) => s.trim())
    .includes(purpose);
}
