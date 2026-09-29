import { type TenantTx, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { keyVault, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AnswerError, checkAnswers, FIELD_TYPES, FieldDefinition, FormDefinition } from './definition.ts';
import {
  type ALL_FORM_KINDS,
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

/**
 * What each kind of form may hold: checkout questions keep the checkout types (no scales);
 * surveys have no sensitive answers (their reports and exports show every answer).
 */
function checkKindRules(kind: Subject['kind'], definition: FormDefinition): void {
  for (const f of definition.fields) {
    if (kind === 'checkout_questions' && !(FIELD_TYPES as readonly string[]).includes(f.type))
      throw new DomainError('validation_failed', 'Not a checkout question type', {
        reason: 'form_invalid',
        field: f.key,
      });
    if (kind === 'survey' && f.sensitive)
      throw new DomainError('validation_failed', 'Survey answers cannot be sensitive', {
        reason: 'form_invalid',
        field: f.key,
      });
  }
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
  checkKindRules(subject.kind, definition);
  const { version } = await writeVersionTx(tx, ctx, subject, definition);
  return { version };
}

/**
 * Append the next immutable version of a form (creating the form on first use), for every kind.
 * The caller has validated the definition for its kind.
 */
export async function writeVersionTx(
  tx: TenantTx,
  ctx: Ctx,
  subject: { kind: (typeof ALL_FORM_KINDS)[number]; subjectType: Subject['subjectType']; subjectId: string },
  definition: object,
): Promise<{ version: number; formId: string; versionId: string }> {
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
  const [row] = await tx
    .insert(formVersions)
    .values({ orgId, formId: form.id, version, definition })
    .returning({ id: formVersions.id });
  if (!row) throw new DomainError('internal');
  await tx.update(forms).set({ currentVersion: version, updatedAt: ctx.now }).where(eq(forms.id, form.id));
  return { version, formId: form.id, versionId: row.id };
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
): Promise<{ id: string; version: number } | null> {
  const orgId = requireOrg(ctx);
  const f = await currentFormTx(tx, input);
  const fields = f?.definition.fields ?? [];
  if (!f || fields.length === 0) {
    if (Object.keys(input.answers).length > 0)
      throw new DomainError('validation_failed', 'This event has no questions', { reason: 'form_invalid' });
    return null;
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
  const [row] = await tx
    .insert(formResponses)
    .values({
      orgId,
      formVersionId: f.versionId,
      respondentType: input.respondentType,
      respondentId: input.respondentId,
      answers: open,
      sensitiveCiphertext: Object.keys(secret).length
        ? await keyVault().encrypt(orgId, new TextEncoder().encode(JSON.stringify(secret)))
        : null,
    })
    .returning({ id: formResponses.id });
  if (!row) throw new DomainError('internal');
  return { id: row.id, version: f.version };
}

/** A question as reports label it (from the newest version that has it). */
export interface QuestionSummary {
  readonly key: string;
  readonly type: FieldDefinition['type'];
  readonly label: string;
  readonly options: Readonly<Record<string, string>>;
}

/**
 * Every non-sensitive response to a subject's form, across all its versions, in the caller's
 * transaction (survey reports and exports, M3.9a). `questions` lists the current version's
 * questions first, then questions only older versions had and someone answered (a question added
 * and removed before anyone answered it is not reported). `respondentIds` narrows the responses,
 * never the questions, so every chunk of an export has the same columns.
 */
export async function subjectResponsesTx(
  tx: TenantTx,
  s: Subject,
  respondentIds?: readonly string[],
): Promise<{
  questions: QuestionSummary[];
  responses: { respondentId: string; version: number; answers: Record<string, unknown>; at: Date }[];
}> {
  const versions = await tx
    .select({ version: formVersions.version, definition: formVersions.definition })
    .from(formVersions)
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(
      and(eq(forms.kind, s.kind), eq(forms.subjectType, s.subjectType), eq(forms.subjectId, s.subjectId)),
    )
    .orderBy(desc(formVersions.version));
  const answered = new Set(
    (
      await tx
        .selectDistinct({ key: sql<string>`jsonb_object_keys(${formResponses.answers})` })
        .from(formResponses)
        .innerJoin(formVersions, eq(formVersions.id, formResponses.formVersionId))
        .innerJoin(forms, eq(forms.id, formVersions.formId))
        .where(
          and(eq(forms.kind, s.kind), eq(forms.subjectType, s.subjectType), eq(forms.subjectId, s.subjectId)),
        )
    ).map((r) => r.key),
  );
  const questions: QuestionSummary[] = [];
  const seen = new Set<string>();
  for (const [i, v] of versions.entries())
    for (const q of FormDefinition.parse(v.definition).fields)
      if (!seen.has(q.key) && (i === 0 || answered.has(q.key))) {
        seen.add(q.key);
        questions.push({
          key: q.key,
          type: q.type,
          label: q.label,
          options: Object.fromEntries(q.options.map((o) => [o.value, o.label])),
        });
      }
  if (respondentIds && respondentIds.length === 0) return { questions, responses: [] };
  const rows = await tx
    .select({
      respondentId: formResponses.respondentId,
      version: formVersions.version,
      answers: formResponses.answers,
      at: formResponses.createdAt,
    })
    .from(formResponses)
    .innerJoin(formVersions, eq(formVersions.id, formResponses.formVersionId))
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(
      and(
        eq(forms.kind, s.kind),
        eq(forms.subjectType, s.subjectType),
        eq(forms.subjectId, s.subjectId),
        respondentIds ? inArray(formResponses.respondentId, [...respondentIds]) : undefined,
      ),
    )
    .orderBy(asc(formResponses.createdAt), asc(formResponses.id));
  return {
    questions,
    responses: rows.map((r) => ({ ...r, answers: r.answers as Record<string, unknown> })),
  };
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
