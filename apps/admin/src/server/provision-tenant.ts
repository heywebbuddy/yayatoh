import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { CreateOrganizationInput, provisionOrganization } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ports } from './ports.ts';
import type { Staff } from './staff.ts';

export const NewTenantInput = CreateOrganizationInput.extend({
  ownerEmail: z.email().trim().toLowerCase(),
  reason: z.string().trim().min(3).max(500),
});

export async function provisionTenant(staff: Staff, value: unknown) {
  if (!staff.can('createTenant')) throw new DomainError('forbidden');
  const { ownerEmail, reason, ...input } = NewTenantInput.parse(value);
  const [owner] = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: resolve organization owner: ${reason}` },
    (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from auth.users where lower(email) = ${ownerEmail} and deleted_at is null limit 1`,
      ),
  );
  if (!owner)
    throw new DomainError('not_found', 'Owner must have an existing account', { field: 'ownerEmail' });
  return provisionOrganization(
    createCtx({ actor: { type: 'system', name: staff.actor } }),
    { ...input, ownerUserId: owner.id, reason },
    ports,
  );
}
