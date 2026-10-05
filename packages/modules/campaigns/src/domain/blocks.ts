import { mergeProblems } from '@yayatoh/notifications/merge';
import { z } from 'zod';

/**
 * The campaign block editor's document (M3.6b). A campaign is an ordered list of blocks; the
 * email is rendered from them with the org's brand kit. Pure and browser-safe: the editor
 * validates with the same schema the server stores.
 */
export const BLOCK_TYPES = ['heading', 'text', 'image', 'button', 'eventCard', 'divider', 'footer'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Email-safe font stacks the brand kit offers (tokens, never free text). */
export const CAMPAIGN_FONTS = ['sans', 'serif', 'rounded'] as const;
export type CampaignFont = (typeof CAMPAIGN_FONTS)[number];

export const CAMPAIGN_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const MAX_BLOCKS = 40;
export const MAX_TEST_ADDRESSES = 5;

const BlockId = z.string().regex(/^[a-z0-9]{1,16}$/);
const uuid = z.uuid();

/** Text an organizer types: trimmed, and every merge field must be a known one. */
const merged = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .superRefine((v, c) => {
      const bad = mergeProblems(v);
      if (bad.length) c.addIssue({ code: 'custom', message: 'unknown_merge_field', params: { fields: bad } });
    });

/** A same-site path (the M3.8a redirector's rule, checked again when the link is created). */
const SitePath = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/(?![/\\])[A-Za-z0-9\-._~/]*$/, 'invalid_path')
  .refine((p) => !p.split('/').some((s) => s === '.' || s === '..'), 'invalid_path');

/** An image: our own media (`/media/…`) or an https URL. */
const ImageSrc = z
  .string()
  .trim()
  .max(500)
  .refine((s) => /^\/media\/[0-9a-zA-Z\-/._]+$/.test(s) || /^https:\/\/[^\s"'<>]+$/.test(s), 'invalid_image');

export const HeadingBlock = z.object({
  id: BlockId,
  type: z.literal('heading'),
  text: merged(1, 200),
});
export const TextBlock = z.object({ id: BlockId, type: z.literal('text'), text: merged(1, 5000) });
export const ImageBlock = z.object({
  id: BlockId,
  type: z.literal('image'),
  src: ImageSrc,
  alt: z.string().trim().min(1).max(300),
});
/** A button always links to one of the org's events (optionally a page of it), through a tracked link. */
export const ButtonBlock = z.object({
  id: BlockId,
  type: z.literal('button'),
  label: merged(1, 80),
  eventId: uuid,
  path: SitePath.nullable().default(null),
});
export const EventCardBlock = z.object({ id: BlockId, type: z.literal('eventCard'), eventId: uuid });
export const DividerBlock = z.object({ id: BlockId, type: z.literal('divider') });
/** The mandatory footer: the org's postal address (CAN-SPAM) and the unsubscribe link, always. */
export const FooterBlock = z.object({
  id: BlockId,
  type: z.literal('footer'),
  postalAddress: z.string().trim().min(5).max(300),
  note: z.string().trim().max(300).default(''),
});

export const Block = z.discriminatedUnion('type', [
  HeadingBlock,
  TextBlock,
  ImageBlock,
  ButtonBlock,
  EventCardBlock,
  DividerBlock,
  FooterBlock,
]);
export type Block = z.infer<typeof Block>;

/** The editable content of a campaign. `smsBody` is the text for SMS/WhatsApp campaigns. */
export const CampaignContent = z
  .object({
    subject: merged(1, 150),
    preheader: z.string().trim().max(150).default(''),
    font: z.enum(CAMPAIGN_FONTS).default('sans'),
    blocks: z.array(Block).min(1).max(MAX_BLOCKS),
    smsBody: merged(0, 800).default(''),
  })
  .superRefine((c, ctx) => {
    const footers = c.blocks.filter((b) => b.type === 'footer');
    if (footers.length !== 1 || c.blocks[c.blocks.length - 1]?.type !== 'footer')
      ctx.addIssue({ code: 'custom', message: 'footer_required', path: ['blocks'] });
    const ids = new Set<string>();
    for (const b of c.blocks) {
      if (ids.has(b.id)) ctx.addIssue({ code: 'custom', message: 'duplicate_block', path: ['blocks'] });
      ids.add(b.id);
    }
  });
export type CampaignContent = z.infer<typeof CampaignContent>;

/** Event ids the content links to (tracked links are created for these at send time). */
export function linkedEventIds(content: Pick<CampaignContent, 'blocks'>): string[] {
  const ids = new Set<string>();
  for (const b of content.blocks) if (b.type === 'button' || b.type === 'eventCard') ids.add(b.eventId);
  return [...ids];
}

/** Blocks that need a tracked link (buttons and event cards), in document order. */
export function linkBlocks(content: Pick<CampaignContent, 'blocks'>) {
  return content.blocks.filter(
    (b): b is Extract<Block, { type: 'button' | 'eventCard' }> =>
      b.type === 'button' || b.type === 'eventCard',
  );
}

/** A new block id (short, unique within a document). */
export function newBlockId(existing: readonly { id: string }[]): string {
  const taken = new Set(existing.map((b) => b.id));
  for (let i = existing.length + 1; ; i++) {
    const id = `b${i.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/** Move a block up or down (the keyboard alternative to dragging). The footer stays last. */
export function moveBlock<B extends { id: string; type: string }>(
  blocks: readonly B[],
  id: string,
  dir: -1 | 1,
): B[] {
  const i = blocks.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return [...blocks];
  if (blocks[i]?.type === 'footer' || blocks[j]?.type === 'footer') return [...blocks];
  const out = [...blocks];
  [out[i], out[j]] = [out[j] as B, out[i] as B];
  return out;
}

/** A sensible first document: a heading, a paragraph and the footer. */
export function starterContent(input: { subject?: string; postalAddress?: string } = {}): CampaignContent {
  return {
    subject: input.subject ?? '',
    preheader: '',
    font: 'sans',
    smsBody: '',
    blocks: [
      { id: 'b1', type: 'heading', text: 'Hello {{first_name|there}}' },
      { id: 'b2', type: 'text', text: '' },
      { id: 'b3', type: 'footer', postalAddress: input.postalAddress ?? '', note: '' },
    ],
  };
}
