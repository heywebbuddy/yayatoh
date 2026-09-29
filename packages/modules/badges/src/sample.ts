import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';
import { BadgeDesign } from './domain/design.ts';
import { type BadgeRow, badgeRow } from './domain/row.ts';
import { badgesHtml } from './render.ts';
import { templatesOfTx } from './templates.ts';

/** Not a ticket: a code no scanner accepts (malformed), so a printed sample admits no one. */
export const SAMPLE_CODE = `YY1SAMPLE${'0'.repeat(40)}`;

const SAMPLES = {
  en: [
    {
      name: 'Ada Lovelace',
      company: 'Analytical Engines Ltd',
      title: 'Chief Mathematician',
      type: 'Speaker',
    },
    {
      name: 'Maximiliana Wolfeschlegelsteinhausen',
      company: 'Initech International',
      title: 'VP Partnerships',
      type: 'General Admission',
    },
  ],
  ar: [
    { name: 'ليلى الفارسي', company: 'شركة الخليج للتقنية', title: 'مديرة المنتجات', type: 'متحدث' },
    {
      name: 'عبد الرحمن بن خالد العتيبي',
      company: 'مؤسسة المستقبل',
      title: 'مهندس برمجيات',
      type: 'دخول عام',
    },
  ],
} as const;

/** Sample badge rows for previews (English or Arabic people), through the same allowlist. */
export function sampleRows(design: BadgeDesign, lang: 'en' | 'ar'): BadgeRow[] {
  const typeIds = Object.keys(design.ribbons);
  return SAMPLES[lang].map((p, i) =>
    badgeRow(
      { ...design, sources: { company: 'company', jobTitle: 'title' } },
      {
        ticketId: `00000000-0000-7000-8000-00000000000${i + 1}`,
        // Show a ribbon when the template has one.
        ticketTypeId: typeIds[i % Math.max(typeIds.length, 1)] ?? '00000000-0000-7000-8000-000000000000',
        typeName: p.type,
        holderName: p.name,
        code: SAMPLE_CODE,
        answers: { company: p.company, title: p.title },
      },
    ),
  );
}

/**
 * A template (or an unsaved design) printed with sample people, for "Preview PDF". Everyone who
 * can see the event can preview; no attendee data is involved.
 */
export const samplePreviewQuery = tenantQuery({
  name: 'badges.samplePreview',
  input: z.object({
    eventId: z.uuid(),
    templateId: z.uuid(),
    lang: z.enum(['en', 'ar']).default('en'),
    /** Preview the editor's unsaved design instead of the saved one. */
    design: BadgeDesign.optional(),
  }),
  output: z.object({ html: z.string() }),
  entitlement: 'badges',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    requireOrg(ctx);
    const t = (await templatesOfTx(tx, input.eventId)).find((x) => x.id === input.templateId);
    if (!t) throw new DomainError('not_found', 'Template not found');
    const design = input.design ?? t.design;
    const shown = input.lang === 'ar' ? { ...design, direction: 'rtl' as const } : design;
    return {
      html: badgesHtml({
        lang: input.lang,
        title: t.name,
        logo: null,
        badges: sampleRows(shown, input.lang).map((row) => ({
          design: shown,
          row,
          qrLabel: `${row.firstName} ${row.lastName}`.trim(),
        })),
      }),
    };
  },
});
