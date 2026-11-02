import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError } from '@yayatoh/kernel';
import { z } from 'zod';
import {
  cleanSupportAssist,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGES_MAX,
  SupportAssistDto,
} from './domain/support-assist.ts';
import type { AiDrafter } from './drafter.ts';
import { chargedCall, messagingCredits, refundCredits, withTimeout } from './spend.ts';

export const SupportAssistInput = z.object({
  kind: z.enum(['conversation', 'refund_request']),
  eventId: z.uuid().nullable().default(null),
  eventName: z.string().max(200).nullable().default(null),
  /** Oldest first. Bodies only: never the customer's email or payment details. */
  messages: z
    .array(
      z.object({
        from: z.enum(['customer', 'organizer']),
        body: z.string().min(1).max(SUPPORT_MESSAGE_MAX),
      }),
    )
    .min(1)
    .max(SUPPORT_MESSAGES_MAX),
  locale: z.string().max(20).default('en'),
});
export type SupportAssistInput = z.input<typeof SupportAssistInput>;

export const SupportAssistResultDto = SupportAssistDto.extend({ balance: z.int() });
export type SupportAssistResultDto = z.infer<typeof SupportAssistResultDto>;

/**
 * AI1: label a customer request and draft an answer. It returns text and changes nothing: the
 * staff member edits and sends the reply, or decides the refund, with the existing commands.
 */
export async function assistSupport(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: SupportAssistInput,
): Promise<SupportAssistResultDto> {
  const p = SupportAssistInput.safeParse(raw);
  if (!p.success) throw new DomainError('validation_failed', 'Invalid request');
  const input = p.data;
  if (!drafter) throw new DomainError('invalid_state', 'AI is off', { reason: 'ai_unavailable' });
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    input.kind === 'refund_request' ? refundCredits : messagingCredits,
    { purpose: 'support_assist', eventId: input.eventId },
    async () =>
      cleanSupportAssist(
        await withTimeout(
          drafter.compose({
            task: 'support_assist',
            locale: input.locale,
            tone: 'formal',
            brand: null,
            orgName: '',
            brief: '',
            kind: input.kind,
            eventName: input.eventName,
            messages: input.messages,
          }),
        ),
      ),
  );
  return { ...value, balance };
}
