import type { TenantTx } from '@yayatoh/db';
import { keyVault } from '@yayatoh/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { FormDefinition } from './definition.ts';
import { RegistrationFormDefinition } from './registration.ts';
import { formResponses, forms, formVersions, type RESPONDENT_TYPES } from './schema.ts';

/** Question key → label, for checkout/survey definitions and paged registration ones. */
function questionLabels(definition: unknown): Record<string, string> {
  const paged = RegistrationFormDefinition.safeParse(definition);
  const fields = paged.success
    ? paged.data.pages.flatMap((p) => p.fields)
    : (FormDefinition.safeParse(definition).data?.fields ?? []);
  return Object.fromEntries(fields.map((f) => [f.key, f.label]));
}

/**
 * A person's form answers (checkout questions answered in their orders), with question labels,
 * sensitive answers decrypted: the subject is entitled to them (M1.14c access requests).
 */
export async function responsesDsarTx(tx: TenantTx, orgId: string, orderIds: readonly string[]) {
  return (await respondentAnswersDsarTx(tx, orgId, 'order', orderIds)).map(({ respondentId, ...r }) => ({
    orderId: respondentId,
    ...r,
  }));
}

/**
 * The answers one kind of respondent gave (orders, survey invitations, registration-form
 * respondents: M6.1c), with question labels and sensitive answers decrypted.
 */
export async function respondentAnswersDsarTx(
  tx: TenantTx,
  orgId: string,
  type: (typeof RESPONDENT_TYPES)[number],
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      respondentId: formResponses.respondentId,
      kind: forms.kind,
      definition: formVersions.definition,
      answers: formResponses.answers,
      sensitiveCiphertext: formResponses.sensitiveCiphertext,
      createdAt: formResponses.createdAt,
    })
    .from(formResponses)
    .innerJoin(formVersions, eq(formVersions.id, formResponses.formVersionId))
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(and(eq(formResponses.respondentType, type), inArray(formResponses.respondentId, [...ids])));
  const out = [];
  for (const r of rows) {
    const secret = r.sensitiveCiphertext
      ? (JSON.parse(
          new TextDecoder().decode(await keyVault().decrypt(orgId, r.sensitiveCiphertext)),
        ) as object)
      : {};
    const labels = questionLabels(r.definition);
    const answers = Object.entries({ ...(r.answers as object), ...secret }).map(([key, value]) => ({
      question: labels[key] ?? key,
      value,
    }));
    out.push({ respondentId: r.respondentId, form: r.kind, answers, createdAt: r.createdAt });
  }
  return out;
}

/** Erase the answers given in these orders (non-sensitive and sensitive). */
export async function eraseResponsesDsarTx(tx: TenantTx, orderIds: readonly string[], now: Date) {
  if (orderIds.length === 0) return { erased: 0 };
  const rows = await tx
    .update(formResponses)
    .set({ answers: {}, sensitiveCiphertext: null, updatedAt: now })
    .where(and(eq(formResponses.respondentType, 'order'), inArray(formResponses.respondentId, [...orderIds])))
    .returning({ id: formResponses.id });
  return { erased: rows.length };
}
