import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError } from '@yayatoh/kernel';
import { z } from 'zod';
import {
  ASSISTANT_QUESTION_MAX,
  type AssistantAnswerDto,
  AssistantSource,
  cleanAssistantAnswer,
  fitSources,
} from './domain/assistant.ts';
import type { AiDrafter } from './drafter.ts';
import { assistantCredits, chargedCall, withTimeout } from './spend.ts';

export const AskHelpInput = z.object({
  question: z.string().trim().min(3).max(ASSISTANT_QUESTION_MAX),
  locale: z.string().max(20).default('en'),
  sources: z.array(AssistantSource).min(1).max(20),
});
export type AskHelpInput = z.input<typeof AskHelpInput>;

/**
 * AI1: a help center question, answered only from published articles the caller found by search.
 * One credit of the platform content org, which owns the help center. The citation rules are the
 * attendee assistant's: an answer that cites nothing real counts as "not known".
 */
export async function askHelp(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: AskHelpInput,
): Promise<AssistantAnswerDto> {
  const p = AskHelpInput.safeParse(raw);
  if (!p.success) throw new DomainError('validation_failed', 'Invalid question');
  const input = p.data;
  if (!drafter) throw new DomainError('invalid_state', 'AI is off', { reason: 'ai_unavailable' });
  const sources = fitSources(input.sources);
  const { value } = await chargedCall(ctx, ports, assistantCredits, { purpose: 'help_answer' }, async () =>
    cleanAssistantAnswer(
      await withTimeout(
        drafter.compose({
          task: 'help_answer',
          locale: input.locale,
          tone: 'friendly',
          brand: null,
          orgName: '',
          brief: input.question,
          sources,
        }),
      ),
      sources,
    ),
  );
  return value;
}
