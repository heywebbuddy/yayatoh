import type { ContactReferenceOwner, MovedRow } from '@yayatoh/crm';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { surveyInvitations, surveyResponses } from './schema.ts';

const INVITATIONS = 'surveys.invitations';
const RESPONSES = 'surveys.responses';

/**
 * Contact merges (M6.1a, ADR 0022): a merged duplicate's survey invitations, and the responses to
 * them, move to the person who stays, except for a survey both were asked (one invitation per
 * survey and person): that invitation and its response stay on the duplicate as history (kept).
 * An undo moves exactly the recorded rows back. Only this module writes its tables.
 */
export const surveysContactOwner: ContactReferenceOwner = {
  module: 'surveys',
  columns: [`${INVITATIONS}.contact_id`, `${RESPONSES}.contact_id`],
  move: async (tx, _ctx, step) => {
    const invitations = await tx.execute<{ id: string }>(sql`
      update surveys.invitations i set contact_id = ${step.toContactId}
      where i.contact_id = ${step.fromContactId}
        and not exists (
          select 1 from surveys.invitations x
          where x.org_id = i.org_id and x.survey_id = i.survey_id and x.contact_id = ${step.toContactId})
      returning i.id`);
    const moved: MovedRow[] = invitations.map((r) => ({ table: INVITATIONS, id: r.id }));
    if (invitations.length > 0) {
      const responses = await tx
        .update(surveyResponses)
        .set({ contactId: step.toContactId })
        .where(
          and(
            eq(surveyResponses.contactId, step.fromContactId),
            inArray(
              surveyResponses.invitationId,
              invitations.map((r) => r.id),
            ),
          ),
        )
        .returning({ id: surveyResponses.id });
      moved.push(...responses.map((r) => ({ table: RESPONSES, id: r.id })));
    }
    const count = async (t: typeof surveyInvitations | typeof surveyResponses) =>
      (
        await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(t)
          .where(eq(t.contactId, step.fromContactId))
      )[0]?.n ?? 0;
    return { moved, kept: { [INVITATIONS]: await count(surveyInvitations), [RESPONSES]: await count(surveyResponses) } };
  },
  restore: async (tx, _ctx, step) => {
    const out: MovedRow[] = [];
    const inv = step.rows.filter((r) => r.table === INVITATIONS).map((r) => r.id);
    if (inv.length > 0) {
      const rows = await tx
        .update(surveyInvitations)
        .set({ contactId: step.fromContactId })
        .where(and(eq(surveyInvitations.contactId, step.toContactId), inArray(surveyInvitations.id, inv)))
        .returning({ id: surveyInvitations.id });
      out.push(...rows.map((r) => ({ table: INVITATIONS, id: r.id })));
    }
    const res = step.rows.filter((r) => r.table === RESPONSES).map((r) => r.id);
    if (res.length > 0) {
      const rows = await tx
        .update(surveyResponses)
        .set({ contactId: step.fromContactId })
        .where(and(eq(surveyResponses.contactId, step.toContactId), inArray(surveyResponses.id, res)))
        .returning({ id: surveyResponses.id });
      out.push(...rows.map((r) => ({ table: RESPONSES, id: r.id })));
    }
    return out;
  },
};
