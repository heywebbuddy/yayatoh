import { LOCALES } from '@yayatoh/contracts';
import { actorId, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { and, asc, eq } from 'drizzle-orm';
import { IntlMessageFormat } from 'intl-messageformat';
import { z } from 'zod';
import { EMAIL_KINDS, kindOf, type MessageKind } from './kinds.ts';
import { templateOverrides } from './schema.ts';
import { renderMessage } from './templates/render.ts';
import { SAMPLE_PARAMS } from './templates/samples.ts';

const EmailKind = z.enum(EMAIL_KINDS as [MessageKind, ...MessageKind[]]);
const Locale = z.enum(LOCALES);
const Copy = z
  .string()
  .trim()
  .max(2000)
  .transform((s) => (s === '' ? null : s))
  .nullable();

/** The placeholders an override may use: the kind's params plus the derived values. */
export function allowedPlaceholders(kind: MessageKind): Set<string> {
  const extra = ['org', 'amount', 'when'];
  return new Set([...kindOf(kind).params, ...extra]);
}

/** Reject copy that is not valid ICU or uses a placeholder the kind never provides. */
export function checkOverrideCopy(kind: MessageKind, locale: string, copy: string): string | null {
  let ast: ReturnType<IntlMessageFormat['getAst']>;
  try {
    ast = new IntlMessageFormat(copy, locale, undefined, { ignoreTag: true }).getAst();
  } catch {
    return 'invalid_syntax';
  }
  const allowed = allowedPlaceholders(kind);
  const names: string[] = [];
  const walk = (nodes: typeof ast) => {
    for (const n of nodes as Array<{ value?: unknown; options?: Record<string, { value: typeof ast }> }>) {
      if (typeof n.value === 'string' && 'type' in n && (n as { type: number }).type !== 0)
        names.push(n.value);
      if (n.options) for (const o of Object.values(n.options)) walk(o.value);
    }
  };
  walk(ast);
  return names.every((n) => allowed.has(n)) ? null : 'unknown_placeholder';
}

export const TemplateOverrideDto = z.object({
  kind: EmailKind,
  locale: Locale,
  subject: z.string().nullable(),
  intro: z.string().nullable(),
  updatedAt: z.date(),
});

export const templateOverridesQuery = tenantQuery({
  name: 'notifications.templateOverrides',
  input: z.object({}),
  output: z.array(TemplateOverrideDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ tx }) =>
    (
      await tx
        .select()
        .from(templateOverrides)
        .orderBy(asc(templateOverrides.kind), asc(templateOverrides.locale))
    )
      .filter((r) => EmailKind.safeParse(r.kind).success && Locale.safeParse(r.locale).success)
      .map((r) => ({
        kind: r.kind as MessageKind,
        locale: r.locale as (typeof LOCALES)[number],
        subject: r.subject,
        intro: r.intro,
        updatedAt: r.updatedAt,
      })),
});

/** Set (or clear, with both fields empty) the org's copy for one kind and locale. */
export const setTemplateOverrideCommand = tenantCommand({
  name: 'notifications.setTemplateOverride',
  input: z.object({ kind: EmailKind, locale: Locale, subject: Copy, intro: Copy }),
  output: z.object({ cleared: z.boolean() }),
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    for (const [field, copy] of [
      ['subject', input.subject],
      ['intro', input.intro],
    ] as const) {
      if (field === 'subject' && copy && copy.length > 200)
        throw new DomainError('validation_failed', 'Subject too long', { field, reason: 'too_long' });
      const problem = copy ? checkOverrideCopy(input.kind, input.locale, copy) : null;
      if (problem)
        throw new DomainError('validation_failed', 'Invalid template copy', { field, reason: problem });
    }
    const where = and(eq(templateOverrides.kind, input.kind), eq(templateOverrides.locale, input.locale));
    if (!input.subject && !input.intro) {
      await tx.delete(templateOverrides).where(where);
      return { cleared: true };
    }
    await tx
      .insert(templateOverrides)
      .values({ orgId, ...input, updatedBy: actorId(ctx.actor) })
      .onConflictDoUpdate({
        target: [templateOverrides.orgId, templateOverrides.kind, templateOverrides.locale],
        set: {
          subject: input.subject,
          intro: input.intro,
          updatedBy: actorId(ctx.actor),
          updatedAt: ctx.now,
        },
      });
    return { cleared: false };
  },
  audit: (input, r) => ({
    action: 'notifications.set_template_override',
    targetType: 'template',
    targetId: `${input.kind}:${input.locale}`,
    data: { cleared: r.cleared },
  }),
});

/** Preview a kind in a locale with sample data, with the org's brand and current (or draft) copy. */
export const previewTemplateQuery = tenantQuery({
  name: 'notifications.previewTemplate',
  input: z.object({ kind: EmailKind, locale: Locale, subject: Copy.optional(), intro: Copy.optional() }),
  output: z.object({ subject: z.string(), html: z.string(), text: z.string(), dir: z.enum(['ltr', 'rtl']) }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const org = await organizationBrandTx(tx, requireOrg(ctx));
    if (!org) throw new DomainError('not_found');
    const [saved] = await tx
      .select()
      .from(templateOverrides)
      .where(and(eq(templateOverrides.kind, input.kind), eq(templateOverrides.locale, input.locale)));
    const r = renderMessage({
      kind: input.kind,
      locale: input.locale,
      params: SAMPLE_PARAMS[input.kind],
      org,
      unsubscribeUrl: '#unsubscribe',
      override: {
        subject: input.subject !== undefined ? input.subject : (saved?.subject ?? null),
        intro: input.intro !== undefined ? input.intro : (saved?.intro ?? null),
      },
    });
    return { subject: r.subject, html: r.html, text: r.text, dir: r.dir };
  },
});
