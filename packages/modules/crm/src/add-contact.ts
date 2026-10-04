import { DomainError } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeEmail, upsertContactTx } from './contacts.ts';
import { contacts } from './schema.ts';

/**
 * Add a contact from outside (M6.4c): /v1 `POST /orgs/{org}/contacts`, Zapier's "Add contact".
 * Finds or creates the org's contact for the email (an existing contact keeps its name unless it
 * had none), so a retried or repeated add never duplicates anyone. It records no consent: adding
 * someone is not permission to market to them. Scope `contacts:write`; the `api_access` module.
 */
export const addContactCommand = tenantCommand({
  name: 'crm.addContact',
  input: z.object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(200).nullable().default(null),
  }),
  output: z.object({ id: z.uuid(), created: z.boolean() }),
  entitlement: 'api_access',
  permission: 'contacts:write',
  handler: async ({ input, ctx, tx }) => {
    const [before] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.emailNorm, normalizeEmail(input.email)));
    const { id } = await upsertContactTx(tx, ctx, { email: input.email, name: input.name, source: 'import' });
    if (!id) throw new DomainError('internal');
    return { id, created: !before };
  },
  audit: (_input, r) => ({
    action: 'crm.contact.add',
    targetType: 'contact',
    targetId: r.id,
    data: { created: r.created },
  }),
});
