import { z } from 'zod';
import { AiOutputError, parseJsonReply } from './compose.ts';

export const SUPPORT_CATEGORIES = [
  'refund',
  'tickets',
  'event_info',
  'access',
  'payment',
  'complaint',
  'other',
] as const;
export const SUPPORT_URGENCIES = ['low', 'normal', 'high'] as const;
export const SUPPORT_DRAFT_MAX = 2000;
export const SUPPORT_MESSAGE_MAX = 2000;
export const SUPPORT_MESSAGES_MAX = 10;

export const SupportAssistDto = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  urgency: z.enum(SUPPORT_URGENCIES),
  summary: z.string().max(300),
  draft: z.string().max(SUPPORT_DRAFT_MAX),
});
export type SupportAssistDto = z.infer<typeof SupportAssistDto>;

const Raw = z.object({
  category: z.string().optional(),
  urgency: z.string().optional(),
  summary: z.string().optional().default(''),
  draft: z.string(),
});

const oneOf = <T extends string>(values: readonly T[], v: string | undefined, fallback: T): T =>
  (values as readonly string[]).includes(v ?? '') ? (v as T) : fallback;

/**
 * Clean an assist reply. Labels come from fixed lists (anything else is `other` / `normal`), the
 * draft is plain text, and links are dropped: a draft goes to a buyer once a person sends it, and
 * a link could only have come from the buyer's own message or from the model.
 */
export function cleanSupportAssist(raw: string): SupportAssistDto {
  const p = Raw.safeParse(parseJsonReply(raw));
  if (!p.success) throw new AiOutputError('support shape');
  const draft = p.data.draft
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/https?:\/\/[^\s)>\]]+/gi, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, SUPPORT_DRAFT_MAX);
  if (!draft) throw new AiOutputError('empty draft');
  return {
    category: oneOf(SUPPORT_CATEGORIES, p.data.category, 'other'),
    urgency: oneOf(SUPPORT_URGENCIES, p.data.urgency, 'normal'),
    summary: p.data.summary
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300),
    draft,
  };
}
