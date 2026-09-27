import { z } from 'zod';
import type { SectionKind } from './content-kinds.ts';
import { safeHref, sanitizeMarkdown } from './markdown.ts';

const Markdown = (max: number) =>
  z
    .string()
    .transform((v) => sanitizeMarkdown(v, max))
    .pipe(z.string().min(1).max(max));
const Line = (max: number) => z.string().trim().min(1).max(max);
const SafeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => safeHref(v) !== null && !v.startsWith('mailto:'), 'must be an http(s) link');

export const TextContent = z.object({ markdown: Markdown(10_000) });
export const FaqContent = z.object({
  items: z
    .array(z.object({ question: Line(300), answer: Markdown(4000) }))
    .min(1)
    .max(50),
});
export const ScheduleContent = z.object({
  items: z
    .array(
      z.object({
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        title: Line(200),
        detail: z.string().trim().max(500).nullable().default(null),
      }),
    )
    .min(1)
    .max(100),
});
export const LocationContent = z
  .object({
    address: z.string().trim().max(500).default(''),
    directions: z
      .string()
      .max(4000)
      .transform((v) => sanitizeMarkdown(v, 4000))
      .default(''),
    mapUrl: SafeUrl.nullable().default(null),
  })
  .refine((v) => v.address || v.directions || v.mapUrl, { message: 'empty', path: ['address'] });
export const LinksContent = z.object({
  items: z
    .array(z.object({ label: Line(120), url: SafeUrl }))
    .min(1)
    .max(30),
});

export const SECTION_CONTENT = {
  text: TextContent,
  faq: FaqContent,
  schedule: ScheduleContent,
  location: LocationContent,
  links: LinksContent,
} as const satisfies Record<SectionKind, z.ZodType>;

export type SectionContent = {
  text: z.infer<typeof TextContent>;
  faq: z.infer<typeof FaqContent>;
  schedule: z.infer<typeof ScheduleContent>;
  location: z.infer<typeof LocationContent>;
  links: z.infer<typeof LinksContent>;
};

/** A section as stored: kind + validated content (discriminated). */
export const SectionBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), content: TextContent }),
  z.object({ kind: z.literal('faq'), content: FaqContent }),
  z.object({ kind: z.literal('schedule'), content: ScheduleContent }),
  z.object({ kind: z.literal('location'), content: LocationContent }),
  z.object({ kind: z.literal('links'), content: LinksContent }),
]);
export type SectionBody = z.infer<typeof SectionBody>;

/**
 * The console edits list-shaped sections as plain text (keyboard- and screen-reader-friendly):
 * - FAQ: blocks separated by a blank line; the first line is the question, the rest the answer.
 * - Schedule: one line per item, `HH:MM | Title | optional detail`.
 * - Links: one line per link, `Label | https://…`.
 * A problem names the 1-based line (FAQ: block) so the form can point at it.
 */
export class SectionTextError extends Error {
  constructor(
    readonly reason: 'faq_answer_missing' | 'schedule_line' | 'schedule_time' | 'links_line' | 'links_url',
    readonly line: number,
  ) {
    super(`${reason} at ${line}`);
  }
}

const lines = (src: string) => src.replace(/\r\n?/g, '\n').split('\n');

export function parseFaqText(src: string): { question: string; answer: string }[] {
  const blocks = src
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((b, i) => {
    const [q = '', ...rest] = b.split('\n');
    const answer = rest.join('\n').trim();
    if (!answer) throw new SectionTextError('faq_answer_missing', i + 1);
    return { question: q.trim().replace(/^q:\s*/i, ''), answer: answer.replace(/^a:\s*/i, '') };
  });
}

export function parseScheduleText(src: string): { time: string; title: string; detail: string | null }[] {
  const out: { time: string; title: string; detail: string | null }[] = [];
  lines(src).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split('|').map((p) => p.trim());
    const [time = '', title = '', ...detail] = parts;
    if (parts.length < 2 || !title) throw new SectionTextError('schedule_line', i + 1);
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(time);
    const hh = m ? Number(m[1]) : -1;
    const mm = m ? Number(m[2]) : -1;
    if (!m || hh > 23 || mm > 59) throw new SectionTextError('schedule_time', i + 1);
    out.push({
      time: `${String(hh).padStart(2, '0')}:${m[2]}`,
      title,
      detail: detail.join(' | ').trim() || null,
    });
  });
  return out;
}

export function parseLinksText(src: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  lines(src).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cut = line.lastIndexOf('|');
    if (cut < 0) throw new SectionTextError('links_line', i + 1);
    const label = line.slice(0, cut).trim();
    const url = line.slice(cut + 1).trim();
    if (!label) throw new SectionTextError('links_line', i + 1);
    if (!SafeUrl.safeParse(url).success) throw new SectionTextError('links_url', i + 1);
    out.push({ label, url });
  });
  return out;
}

export const formatFaqText = (c: SectionContent['faq']) =>
  c.items.map((i) => `${i.question}\n${i.answer}`).join('\n\n');
export const formatScheduleText = (c: SectionContent['schedule']) =>
  c.items.map((i) => [i.time, i.title, ...(i.detail ? [i.detail] : [])].join(' | ')).join('\n');
export const formatLinksText = (c: SectionContent['links']) =>
  c.items.map((i) => `${i.label} | ${i.url}`).join('\n');
