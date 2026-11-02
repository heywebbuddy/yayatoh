import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError } from '@yayatoh/kernel';
import { z } from 'zod';
import {
  cleanTranslation,
  countWords,
  TRANSLATE_MAX_WORDS,
  TRANSLATE_SEGMENTS_MAX,
  translateCredits,
} from './domain/translate.ts';
import type { AiDrafter } from './drafter.ts';
import { chargedCall, contentCredits, withTimeout } from './spend.ts';

export const TranslateInput = z.object({
  targetLocale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  segments: z
    .record(z.string().max(60), z.string().max(40_000))
    .refine((s) => Object.keys(s).length <= TRANSLATE_SEGMENTS_MAX),
  locale: z.string().max(20).default('en'),
});
export type TranslateInput = z.input<typeof TranslateInput>;

export const TranslateResultDto = z.object({
  segments: z.record(z.string(), z.string()),
  balance: z.int(),
});
export type TranslateResultDto = z.infer<typeof TranslateResultDto>;

/**
 * AI1: a draft translation of a help article or campaign. It returns text only: the caller saves
 * it as a draft through the normal commands, and a person publishes or sends it. Too long for one
 * call is refused before anything is spent, with reason `too_long`.
 */
export async function translateContent(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: TranslateInput,
): Promise<TranslateResultDto> {
  const p = TranslateInput.safeParse(raw);
  if (!p.success) throw new DomainError('validation_failed', 'Invalid text');
  const input = p.data;
  if (!drafter) throw new DomainError('invalid_state', 'AI is off', { reason: 'ai_unavailable' });
  const words = countWords(input.segments);
  if (words === 0) throw new DomainError('validation_failed', 'Nothing to translate');
  if (words > TRANSLATE_MAX_WORDS)
    throw new DomainError('invalid_state', 'Too long to translate at once', { reason: 'too_long' });
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    contentCredits,
    { purpose: 'translate', credits: translateCredits(words) },
    async () =>
      cleanTranslation(
        await withTimeout(
          drafter.compose({
            task: 'translate',
            locale: input.targetLocale,
            tone: 'formal',
            brand: null,
            orgName: '',
            brief: '',
            targetLocale: input.targetLocale,
            segments: input.segments,
          }),
        ),
        input.segments,
      ),
  );
  return { segments: value, balance };
}
