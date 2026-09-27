import type { TenantTx } from '@yayatoh/db';
import { keyVault } from '@yayatoh/platform';
import { and, eq, inArray } from 'drizzle-orm';
import { FormDefinition } from './definition.ts';
import { formResponses, forms, formVersions } from './schema.ts';

/**
 * A person's form answers (checkout questions answered in their orders), with question labels,
 * sensitive answers decrypted: the subject is entitled to them (M1.14c access requests).
 */
export async function responsesDsarTx(tx: TenantTx, orgId: string, orderIds: readonly string[]) {
  if (orderIds.length === 0) return [];
  const rows = await tx
    .select({
      orderId: formResponses.respondentId,
      kind: forms.kind,
      definition: formVersions.definition,
      answers: formResponses.answers,
      sensitiveCiphertext: formResponses.sensitiveCiphertext,
      createdAt: formResponses.createdAt,
    })
    .from(formResponses)
    .innerJoin(formVersions, eq(formVersions.id, formResponses.formVersionId))
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(
      and(eq(formResponses.respondentType, 'order'), inArray(formResponses.respondentId, [...orderIds])),
    );
  const out = [];
  for (const r of rows) {
    const secret = r.sensitiveCiphertext
      ? (JSON.parse(
          new TextDecoder().decode(await keyVault().decrypt(orgId, r.sensitiveCiphertext)),
        ) as object)
      : {};
    const labels = Object.fromEntries(FormDefinition.parse(r.definition).fields.map((f) => [f.key, f.label]));
    const answers = Object.entries({ ...(r.answers as object), ...secret }).map(([key, value]) => ({
      question: labels[key] ?? key,
      value,
    }));
    out.push({ orderId: r.orderId, form: r.kind, answers, createdAt: r.createdAt });
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
