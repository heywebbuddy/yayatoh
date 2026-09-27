import { type TenantTx, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { keyVault, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AnswerError, checkAnswers, FieldDefinition, FormDefinition } from './definition.ts';
import {
  FORM_KINDS,
  formResponses,
  forms,
  formVersions,
  type RESPONDENT_TYPES,
  SUBJECT_TYPES,
} from './schema.ts';

const Subject = z.object({
  kind: z.enum(FORM_KINDS),
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.uuid(),
});
type Subject = z.infer<typeof Subject>;

/** The questions as a buyer sees them (allowlist; the whole definition is organizer-authored). */
export const PublicFormDto = z.object({
  version: z.int(),
  fields: z.array(
    z.object({
      key: z.string(),
      type: FieldDefinition.shape.type,
      label: z.string(),
      help: z.string().nullable(),
      required: z.boolean(),
      sensitive: z.boolean(),
      options: z.array(z.object({ value: z.string(), label: z.string() })),
      min: z.int().nullable(),
      max: z.int().nullable(),
      showIf: z.unknown().nullable(),
    }),
  ),
});
export type PublicFormDto = z.infer<typeof PublicFormDto>;

/** The subject's current form version, inside the caller's tenant transaction. */
export async function currentFormTx(tx: TenantTx, s: Subject) {
  const [row] = await tx
    .select({
      versionId: formVersions.id,
      version: formVersions.version,
      definition: formVersions.definition,
    })
    .from(forms)
    .innerJoin(
      formVersions,
      and(eq(formVersions.formId, forms.id), eq(formVersions.version, forms.currentVersion)),
    )
    .where(
      and(eq(forms.kind, s.kind), eq(forms.subjectType, s.subjectType), eq(forms.subjectId, s.subjectId)),
    );
  return row ? { ...row, definition: FormDefinition.parse(row.definition) } : null;
}

/** Public read after the caller resolved the org server-side (e.g. from the event slug). */
export async function publicForm(orgId: string, s: Subject): Promise<PublicFormDto | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'forms.public' } });
  const f = await withTenant(ctx, (tx) => currentFormTx(tx, s));
  if (!f || f.definition.fields.length === 0) return null;
  return PublicFormDto.parse({ version: f.version, fields: f.definition.fields });
}

/**
 * Write a new version of a subject's form inside the caller's transaction (publishing, and
 * copying an event's questions to a duplicate or template, M1.4b).
 */
export async function publishFormTx(
  tx: TenantTx,
  ctx: Ctx,
  subject: Subject,
  definition: FormDefinition,
): Promise<{ version: number }> {
  const orgId = requireOrg(ctx);
  await tx
    .insert(forms)
    .values({ orgId, kind: subject.kind, subjectType: subject.subjectType, subjectId: subject.subjectId })
    .onConflictDoNothing();
  // Lock the form row so concurrent publishes get consecutive versions.
  const [form] = await tx
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.kind, subject.kind),
        eq(forms.subjectType, subject.subjectType),
        eq(forms.subjectId, subject.subjectId),
      ),
    )
    .for('update');
  if (!form) throw new DomainError('internal');
  const version = form.currentVersion + 1;
  await tx.insert(formVersions).values({ orgId, formId: form.id, version, definition });
  await tx.update(forms).set({ currentVersion: version, updatedAt: ctx.now }).where(eq(forms.id, form.id));
  return { version };
}

export const publishFormCommand = tenantCommand({
  name: 'forms.publishForm',
  input: Subject.extend({ definition: FormDefinition }),
  output: z.object({ version: z.int() }),
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => publishFormTx(tx, ctx, input, input.definition),
  audit: (input, r) => ({
    action: 'form.publish',
    targetType: 'form',
    targetId: null,
    data: {
      kind: input.kind,
      subjectId: input.subjectId,
      version: r?.version,
      fields: input.definition.fields.length,
    },
  }),
});

export const getFormQuery = tenantQuery({
  name: 'forms.getForm',
  input: Subject,
  output: z.object({ version: z.int(), definition: FormDefinition }).nullable(),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const f = await currentFormTx(tx, input);
    return f ? { version: f.version, definition: f.definition } : null;
  },
});

/**
 * Validate and store one respondent's answers against the current version, in the caller's
 * transaction (checkout). Sensitive answers are envelope-encrypted; hidden ones are dropped.
 */
export async function submitResponseTx(
  tx: TenantTx,
  ctx: Ctx,
  input: Subject & {
    respondentType: (typeof RESPONDENT_TYPES)[number];
    respondentId: string;
    answers: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const orgId = requireOrg(ctx);
  const f = await currentFormTx(tx, input);
  const fields = f?.definition.fields ?? [];
  if (!f || fields.length === 0) {
    if (Object.keys(input.answers).length > 0)
      throw new DomainError('validation_failed', 'This event has no questions', { reason: 'form_invalid' });
    return;
  }
  let clean: Record<string, unknown>;
  try {
    clean = checkAnswers(f.definition, input.answers);
  } catch (err) {
    if (err instanceof AnswerError)
      throw new DomainError('validation_failed', err.message, { reason: 'form_invalid', field: err.field });
    throw err;
  }
  const sensitiveKeys = new Set(fields.filter((x) => x.sensitive).map((x) => x.key));
  const open: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean)) (sensitiveKeys.has(k) ? secret : open)[k] = v;
  await tx.insert(formResponses).values({
    orgId,
    formVersionId: f.versionId,
    respondentType: input.respondentType,
    respondentId: input.respondentId,
    answers: open,
    sensitiveCiphertext: Object.keys(secret).length
      ? await keyVault().encrypt(orgId, new TextEncoder().encode(JSON.stringify(secret)))
      : null,
  });
}

export const ResponseDto = z.object({
  respondentId: z.uuid(),
  version: z.int(),
  answers: z.record(z.string(), z.unknown()),
});

/** Answers for organizers (orders:read), with the labels of the version each was given against. */
export const listResponsesQuery = tenantQuery({
  name: 'forms.listResponses',
  input: Subject.extend({ respondentIds: z.array(z.uuid()).max(500) }),
  output: z.object({
    /** Question label and choice labels, from the newest version that has the question. */
    questions: z.record(
      z.string(),
      z.object({ label: z.string(), options: z.record(z.string(), z.string()) }),
    ),
    responses: z.array(ResponseDto),
  }),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    if (input.respondentIds.length === 0) return { questions: {}, responses: [] };
    const rows = await tx
      .select({
        respondentId: formResponses.respondentId,
        version: formVersions.version,
        definition: formVersions.definition,
        answers: formResponses.answers,
        sensitiveCiphertext: formResponses.sensitiveCiphertext,
      })
      .from(formResponses)
      .innerJoin(formVersions, eq(formVersions.id, formResponses.formVersionId))
      .innerJoin(forms, eq(forms.id, formVersions.formId))
      .where(
        and(
          eq(forms.kind, input.kind),
          eq(forms.subjectType, input.subjectType),
          eq(forms.subjectId, input.subjectId),
          inArray(formResponses.respondentId, input.respondentIds),
        ),
      )
      .orderBy(desc(formVersions.version));
    const questions: Record<string, { label: string; options: Record<string, string> }> = {};
    const responses = [];
    for (const r of rows) {
      for (const q of FormDefinition.parse(r.definition).fields)
        questions[q.key] ??= {
          label: q.label,
          options: Object.fromEntries(q.options.map((o) => [o.value, o.label])),
        };
      const secret = r.sensitiveCiphertext
        ? JSON.parse(
            new TextDecoder().decode(await keyVault().decrypt(requireOrg(ctx), r.sensitiveCiphertext)),
          )
        : {};
      responses.push({
        respondentId: r.respondentId,
        version: r.version,
        answers: { ...(r.answers as object), ...secret },
      });
    }
    return { questions, responses };
  },
});
