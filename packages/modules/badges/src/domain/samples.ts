import type { BadgeDesign } from './design.ts';
import { type BadgeRow, badgeRow } from './row.ts';

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
