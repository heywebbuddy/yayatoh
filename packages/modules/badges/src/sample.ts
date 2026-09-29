import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';
import { BadgeDesign } from './domain/design.ts';
import { sampleRows } from './domain/samples.ts';
import { badgesHtml } from './render.ts';
import { templatesOfTx } from './templates.ts';

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
