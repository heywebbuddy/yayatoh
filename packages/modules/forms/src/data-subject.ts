import type { TenantTx } from '@yayatoh/db';
import { requireOrg } from '@yayatoh/kernel';
import {
  type DataSubject,
  defineDataSubjectContributor,
  ERASED_EMAIL,
  ERASED_NAME,
  REDACT,
  refsOf,
  type SubjectErasure,
  type SubjectRefs,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { respondentAnswersDsarTx } from './dsar.ts';
import { formResponses, respondents } from './schema.ts';

/** Registration-form respondents who are the person (by address). */
async function respondentRowsTx(tx: TenantTx, s: DataSubject) {
  return tx
    .select()
    .from(respondents)
    .where(sql`lower(btrim(${respondents.email})) = ${s.email}`)
    .orderBy(asc(respondents.createdAt));
}

/**
 * forms' part of a data-subject request (M6.1c). Answers are tied to whoever gave them: the
 * person's orders (checkout questions), their survey invitations (`survey_invitation` refs from
 * surveys) and their registration-form respondent rows (by address). Answers are emptied (the
 * sealed ones dropped) and respondent rows keep their form, type and dates but lose name, address
 * and draft answers. Exports decrypt sealed answers: the person is entitled to them.
 */
export const formsDataSubjects = defineDataSubjectContributor({
  module: 'forms',
  tables: {
    'forms.form_responses': REDACT,
    'forms.respondents': REDACT,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await respondentRowsTx(tx, s);
    return {
      form_respondent: rows.map((r) => r.id),
      name: [...new Set(rows.map((r) => r.name).filter((n) => n && n !== ERASED_NAME))],
    };
  },
  async export(tx, s, ctx) {
    const orgId = requireOrg(ctx);
    const rows = await respondentRowsTx(tx, s);
    return {
      sections: {
        orderAnswers: await respondentAnswersDsarTx(tx, orgId, 'order', refsOf(s, 'order')),
        surveyAnswers: await respondentAnswersDsarTx(
          tx,
          orgId,
          'survey_invitation',
          refsOf(s, 'survey_invitation'),
        ),
        registrationAnswers: await respondentAnswersDsarTx(
          tx,
          orgId,
          'form_respondent',
          rows.map((r) => r.id),
        ),
        // Drafts: what the person typed so far (sealed draft answers are left out).
        registrationRespondents: rows.map((r) => ({
          formId: r.formId,
          name: r.name,
          email: r.email,
          locale: r.locale,
          draftAnswers: r.submittedAt ? {} : r.answers,
          startedAt: r.createdAt,
          submittedAt: r.submittedAt,
          expiresAt: r.expiresAt,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const respondentIds = (await respondentRowsTx(tx, s)).map((r) => r.id);
    const by = (type: string, ids: readonly string[]) =>
      ids.length
        ? and(eq(formResponses.respondentType, type), inArray(formResponses.respondentId, [...ids]))
        : undefined;
    const where = or(
      by('order', refsOf(s, 'order')),
      by('survey_invitation', refsOf(s, 'survey_invitation')),
      by('form_respondent', respondentIds),
    ) as SQL | undefined;
    const answers = where
      ? await tx
          .update(formResponses)
          .set({ answers: {}, sensitiveCiphertext: null, updatedAt: ctx.now })
          .where(where)
          .returning({ id: formResponses.id })
      : [];
    const people = respondentIds.length
      ? await tx
          .update(respondents)
          .set({
            name: ERASED_NAME,
            email: ERASED_EMAIL,
            answers: {},
            sensitiveCiphertext: null,
            updatedAt: ctx.now,
          })
          .where(inArray(respondents.id, respondentIds))
          .returning({ id: respondents.id })
      : [];
    return { erased: { 'forms.form_responses': answers.length, 'forms.respondents': people.length } };
  },
});
