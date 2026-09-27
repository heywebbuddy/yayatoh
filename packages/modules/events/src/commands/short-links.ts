import { isUniqueViolation, type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { generateShortCode, normalizeShortCode, vanityProblem } from '../domain/short-code.ts';
import { ShortLinkDto } from '../dto-content.ts';
import { events } from '../schema.ts';
import { shortLinks } from '../schema-content.ts';

/**
 * Give an event its automatic short code if it has none. Codes are global; a clash (another org
 * or event holds the code) retries with a fresh code inside a savepoint.
 */
export async function ensureAutoShortLinkTx(tx: TenantTx, orgId: string, eventId: string): Promise<string> {
  const [existing] = await tx
    .select({ code: shortLinks.code })
    .from(shortLinks)
    .where(and(eq(shortLinks.eventId, eventId), eq(shortLinks.kind, 'auto')));
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateShortCode();
    try {
      await tx.transaction((sp) => sp.insert(shortLinks).values({ orgId, eventId, code, kind: 'auto' }));
      return code;
    } catch (err) {
      if (!isUniqueViolation(err, 'short_links_code_key')) throw err;
    }
  }
  throw new DomainError('internal', 'Could not allocate a short code');
}

export const shortLinksQuery = tenantQuery({
  name: 'events.shortLinks',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(ShortLinkDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: ({ input, tx }) =>
    tx
      .select({ code: shortLinks.code, kind: shortLinks.kind })
      .from(shortLinks)
      .where(eq(shortLinks.eventId, input.eventId))
      .orderBy(asc(shortLinks.kind)) as Promise<ShortLinkDto[]>,
});

/** Make sure the event has its automatic code (events created before M1.4d, or a repair). */
export const ensureShortLinkCommand = tenantCommand({
  name: 'events.ensureShortLink',
  input: z.object({ eventId: z.uuid() }),
  output: ShortLinkDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [e] = await tx.select({ id: events.id }).from(events).where(eq(events.id, input.eventId));
    if (!e) throw new DomainError('not_found');
    return { code: await ensureAutoShortLinkTx(tx, requireOrg(ctx), input.eventId), kind: 'auto' as const };
  },
  audit: (input) => ({ action: 'event.short_link.ensure', targetType: 'event', targetId: input.eventId }),
});

/**
 * Set (or with `code: null`, remove) the event's vanity short code. Validated, lower-cased and
 * globally unique: a code another org or event holds is a `conflict`.
 */
export const setVanityShortLinkCommand = tenantCommand({
  name: 'events.setVanityShortLink',
  input: z.object({ eventId: z.uuid(), code: z.string().max(100).nullable() }),
  output: z.array(ShortLinkDto),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [e] = await tx.select({ id: events.id }).from(events).where(eq(events.id, input.eventId));
    if (!e) throw new DomainError('not_found');
    await ensureAutoShortLinkTx(tx, orgId, input.eventId);
    if (input.code === null || input.code.trim() === '') {
      await tx
        .delete(shortLinks)
        .where(and(eq(shortLinks.eventId, input.eventId), eq(shortLinks.kind, 'vanity')));
    } else {
      const problem = vanityProblem(input.code);
      if (problem)
        throw new DomainError('validation_failed', 'Invalid short code', { reason: problem, field: 'code' });
      const code = normalizeShortCode(input.code);
      try {
        await tx.transaction(async (sp) => {
          await sp
            .insert(shortLinks)
            .values({ orgId, eventId: input.eventId, code, kind: 'vanity' })
            .onConflictDoUpdate({
              target: [shortLinks.orgId, shortLinks.eventId, shortLinks.kind],
              set: { code, updatedAt: ctx.now },
            });
        });
      } catch (err) {
        if (isUniqueViolation(err, 'short_links_code_key'))
          throw new DomainError('conflict', 'This short link is taken', {
            reason: 'short_code_taken',
            field: 'code',
          });
        throw err;
      }
    }
    emit({
      type: 'event.short_link_changed',
      version: 1,
      aggregateType: 'event',
      aggregateId: input.eventId,
      payload: { orgId, eventId: input.eventId },
    });
    return tx
      .select({ code: shortLinks.code, kind: shortLinks.kind })
      .from(shortLinks)
      .where(eq(shortLinks.eventId, input.eventId))
      .orderBy(asc(shortLinks.kind)) as Promise<ShortLinkDto[]>;
  },
  audit: (input) => ({
    action: 'event.short_link.vanity',
    targetType: 'event',
    targetId: input.eventId,
    data: { code: input.code },
  }),
});

/**
 * `/e/{code}` → the event slug (cross-tenant, SECURITY DEFINER). Only events with a public page
 * resolve (published, postponed, cancelled or completed; drafts never), of live orgs.
 */
export async function resolveShortLink(code: string): Promise<string | null> {
  const normalized = normalizeShortCode(code);
  if (!/^[a-z0-9-]{1,40}$/.test(normalized)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ slug: string }>(sql`select slug from events.short_link_target(${normalized})`),
  );
  return rows[0]?.slug ?? null;
}
