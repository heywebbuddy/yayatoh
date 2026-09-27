import type { TenantTx } from '@yayatoh/db';
import { isUniqueViolation } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  requireOrg,
  uuidv7,
} from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { CreateOrganizationInput, OrganizationDto, UpdateOrganizationInput } from '../dto.ts';
import { memberships, organizations } from '../schema.ts';

export const createOrganizationCommand = tenantCommand({
  name: 'tenancy.createOrganization',
  input: CreateOrganizationInput,
  output: OrganizationDto,
  entitlement: null,
  permission: 'platform:org.create',
  handler: async ({ input, ctx, tx, emit }) => {
    const id = requireOrg(ctx);
    let row: typeof organizations.$inferSelect | undefined;
    try {
      [row] = await tx
        .insert(organizations)
        .values({ id, orgId: id, ...input })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'organizations_slug_key')) {
        throw new DomainError('conflict', 'This address is already taken', { field: 'slug' });
      }
      throw err;
    }
    if (!row) throw new DomainError('internal');
    if (ctx.actor.type === 'user') {
      await tx.insert(memberships).values({ orgId: id, userId: ctx.actor.userId, role: 'owner' });
    }
    emit({
      type: 'organization.created',
      version: 1,
      aggregateType: 'organization',
      aggregateId: id,
      payload: { orgId: id, slug: row.slug, kind: row.kind, defaultProfile: row.defaultProfile },
    });
    return row;
  },
  audit: (_input, row) => ({ action: 'organization.create', targetType: 'organization', targetId: row.id }),
});

/**
 * Create an organization. The new org's id is allocated here and becomes the tenant context,
 * so the org row and its owner membership are written under that org's RLS.
 */
export function createOrganization(ctx: Ctx, input: unknown, ports: CommandPorts<TenantTx>) {
  const orgId = uuidv7(ctx.now.getTime());
  return executeCommand(createOrganizationCommand, input, { ...ctx, orgId }, ports);
}

export const updateOrganizationCommand = tenantCommand({
  name: 'tenancy.updateOrganization',
  input: UpdateOrganizationInput,
  output: OrganizationDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx, emit }) => {
    const id = requireOrg(ctx);
    const [row] = await tx
      .update(organizations)
      .set({ ...input, updatedAt: ctx.now })
      .where(eq(organizations.id, id))
      .returning();
    if (!row) throw new DomainError('not_found');
    emit({
      type: 'organization.updated',
      version: 1,
      aggregateType: 'organization',
      aggregateId: id,
      payload: { orgId: id, fields: Object.keys(input) },
    });
    return row;
  },
  audit: (input, row) => ({
    action: 'organization.update',
    targetType: 'organization',
    targetId: row.id,
    data: { fields: Object.keys(input) },
  }),
});
