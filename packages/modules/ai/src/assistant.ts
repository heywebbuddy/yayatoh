import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError } from '@yayatoh/kernel';
import { z } from 'zod';
import {
  ASSISTANT_QUESTION_MAX,
  AssistantAnswerDto,
  AssistantSource,
  cleanAssistantAnswer,
  fitSources,
} from './domain/assistant.ts';
import type { AiDrafter } from './drafter.ts';
import { assistantCredits, chargedCall, withTimeout } from './spend.ts';

export const AskAssistantInput = z.object({
  eventId: z.uuid(),
  question: z.string().trim().min(3).max(ASSISTANT_QUESTION_MAX),
  locale: z.string().max(20).default('en'),
  eventName: z.string().min(1).max(200),
  sources: z.array(AssistantSource).min(1).max(120),
});
export type AskAssistantInput = z.input<typeof AskAssistantInput>;

export const AssistantResultDto = AssistantAnswerDto.extend({ balance: z.number().int() });
export type AssistantResultDto = z.infer<typeof AssistantResultDto>;

/**
 * An attendee asks the assistant about one event. One credit from the event's organizer (refunded
 * when the provider fails), spent through a `public:` command because the attendee is not a
 * member. The caller must have checked that the organizer turned the assistant on for this event
 * and built `sources` from that event's published data only; this function keeps the answer to
 * them (`cleanAssistantAnswer`).
 */
export async function askEventAssistant(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: AskAssistantInput,
): Promise<AssistantResultDto> {
  const p = AskAssistantInput.safeParse(raw);
  if (!p.success) throw new DomainError('validation_failed', 'Invalid question');
  const input = p.data;
  if (!drafter) throw new DomainError('invalid_state', 'AI is off', { reason: 'ai_unavailable' });
  const sources = fitSources(input.sources);
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    assistantCredits,
    { purpose: 'assistant', eventId: input.eventId },
    async () =>
      cleanAssistantAnswer(
        await withTimeout(
          drafter.compose({
            task: 'assistant',
            locale: input.locale,
            tone: 'friendly',
            brand: null,
            orgName: '',
            brief: input.question,
            eventName: input.eventName,
            sources,
          }),
        ),
        sources,
      ),
  );
  return { ...value, balance };
}
