import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { connectionTx, MappingDto, parseRules, requireConnector } from './connections.ts';
import { MAPPING_DIRECTIONS, MappingRules, validateMapping } from './domain/mapping.ts';
import { fieldMappings, syncErrors } from './schema.ts';
import { mappingFields } from './sdk/connector.ts';

/**
 * Field mapping (M6.4a): one editor for every connector. A save checks the rules against the
 * connector's fields and adds the next version; the newest version is in force from the next run.
 * Records the old mapping rejected are retried at once with the new one.
 */
export const saveMappingCommand = tenantCommand({
  name: 'integrations.saveMapping',
  input: z.object({
    connectionId: z.uuid(),
    objectType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    direction: z.enum(MAPPING_DIRECTIONS),
    rules: MappingRules,
  }),
  output: MappingDto,
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const c = await connectionTx(tx, input.connectionId, true);
    if (c.status === 'revoked' || c.status === 'failed' || c.status === 'pending')
      throw new DomainError('invalid_state', 'Map fields on a connected integration');
    const object = requireConnector(c.connector).objects.find((o) => o.key === input.objectType);
    if (!object?.[input.direction]) throw new DomainError('not_found', 'Unknown object');
    const { sources, targets } = mappingFields(object, input.direction);
    const problems = validateMapping(input.rules, sources, targets);
    if (problems.length)
      throw new DomainError('validation_failed', 'The mapping is not valid', {
        issues: problems.map((p) => ({
          path: p.index === null ? 'rules' : `rules.${p.index}`,
          code: p.code,
          field: p.field,
        })),
      });
    const [last] = await tx
      .select({ version: fieldMappings.version })
      .from(fieldMappings)
      .where(
        and(
          eq(fieldMappings.connectionId, c.id),
          eq(fieldMappings.objectType, input.objectType),
          eq(fieldMappings.direction, input.direction),
        ),
      )
      .orderBy(desc(fieldMappings.version))
      .limit(1);
    const [row] = await tx
      .insert(fieldMappings)
      .values({
        orgId,
        connectionId: c.id,
        objectType: input.objectType,
        direction: input.direction,
        version: (last?.version ?? 0) + 1,
        rules: input.rules,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    // Mapping failures get another go with the new rules on the next run.
    await tx
      .update(syncErrors)
      .set({ nextRetryAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(syncErrors.connectionId, c.id),
          eq(syncErrors.status, 'open'),
          eq(syncErrors.step, 'map'),
          eq(syncErrors.objectType, input.objectType),
          eq(syncErrors.direction, input.direction),
        ),
      );
    return {
      objectType: row.objectType,
      direction: row.direction as MappingDto['direction'],
      version: row.version,
      rules: input.rules,
      createdAt: row.createdAt,
    };
  },
  audit: (input, r) => ({
    action: 'integrations.mapping.save',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: {
      objectType: input.objectType,
      direction: input.direction,
      version: r.version,
      rules: r.rules.length,
    },
  }),
});

/** Every version of one object's mapping, newest first (the version history). */
export const mappingVersionsQuery = tenantQuery({
  name: 'integrations.mappingVersions',
  input: z.object({
    connectionId: z.uuid(),
    objectType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    direction: z.enum(MAPPING_DIRECTIONS),
  }),
  output: z.array(MappingDto.extend({ createdBy: z.uuid().nullable() })),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    await connectionTx(tx, input.connectionId);
    const rows = await tx
      .select()
      .from(fieldMappings)
      .where(
        and(
          eq(fieldMappings.connectionId, input.connectionId),
          eq(fieldMappings.objectType, input.objectType),
          eq(fieldMappings.direction, input.direction),
        ),
      )
      .orderBy(desc(fieldMappings.version))
      .limit(50);
    return rows.map((m) => ({
      objectType: m.objectType,
      direction: m.direction as MappingDto['direction'],
      version: m.version,
      rules: parseRules(m.rules),
      createdAt: m.createdAt,
      createdBy: m.createdBy,
    }));
  },
});
