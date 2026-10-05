import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import { eventTemplates } from './schema.ts';
import { EventSnapshot, type TemplateDto, templateDtoOf } from './templates.ts';

/**
 * M6.8b: templates published downward by an agency. The agency reads its own template here; the
 * client gets its own copy (a plain template of the client org, which it owns and keeps).
 */
export interface TemplateContent {
  readonly name: string;
  readonly description: string | null;
  readonly snapshot: EventSnapshot;
}

/** One template of the current org, with its snapshot (null if missing). */
export async function templateContentTx(tx: TenantTx, templateId: string): Promise<TemplateContent | null> {
  const [t] = await tx.select().from(eventTemplates).where(eq(eventTemplates.id, templateId));
  if (!t) return null;
  return { name: t.name, description: t.description, snapshot: EventSnapshot.parse(t.snapshot) };
}

/**
 * Insert a copy into the current org. A name already taken gets the `suffix` (e.g. the agency's
 * name) in brackets; if that is taken too, a conflict on `name`.
 */
export async function insertTemplateCopyTx(
  tx: TenantTx,
  ctx: Ctx,
  input: TemplateContent & { suffix: string },
): Promise<TemplateDto> {
  const snapshot = EventSnapshot.parse(input.snapshot);
  const names = [input.name, `${input.name} (${input.suffix})`.slice(0, 120)];
  for (const name of names) {
    try {
      const [row] = await tx.transaction(async (sp) =>
        sp
          .insert(eventTemplates)
          .values({
            orgId: requireOrg(ctx),
            name,
            description: input.description,
            profile: snapshot.event.profile,
            sourceEventId: null,
            snapshot,
            createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
          })
          .returning(),
      );
      if (!row) throw new DomainError('internal');
      return templateDtoOf(row);
    } catch (err) {
      if (!isUniqueViolation(err, 'event_templates_org_name_key')) throw err;
    }
  }
  throw new DomainError('conflict', 'A template with this name exists', { field: 'name' });
}

/** Replace a copy's description and snapshot (a re-publish); null if the client deleted it. */
export async function replaceTemplateCopyTx(
  tx: TenantTx,
  templateId: string,
  input: Omit<TemplateContent, 'name'>,
  now: Date,
): Promise<TemplateDto | null> {
  const snapshot = EventSnapshot.parse(input.snapshot);
  const [row] = await tx
    .update(eventTemplates)
    .set({ description: input.description, snapshot, profile: snapshot.event.profile, updatedAt: now })
    .where(eq(eventTemplates.id, templateId))
    .returning();
  return row ? templateDtoOf(row) : null;
}

/** Ids of the current org's templates among `ids` (what a client still holds). */
export async function existingTemplateIdsTx(tx: TenantTx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: eventTemplates.id }).from(eventTemplates);
  const want = new Set(ids);
  return rows.map((r) => r.id).filter((id) => want.has(id));
}
