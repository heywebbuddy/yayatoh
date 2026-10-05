import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_SECTIONS_PER_EVENT } from './commands/content.ts';
import { SectionBody } from './domain/sections.ts';
import { eventSections } from './schema-content.ts';

/**
 * U6: an event page's content sections as a copy or a template holds them (kind, title, content,
 * visibility, in order). Content is re-validated on the way in, like a section added by hand.
 */
export const SectionsSnapshot = z
  .array(
    z.intersection(
      z.object({ title: z.string().trim().min(1).max(120), visible: z.boolean().default(true) }),
      SectionBody,
    ),
  )
  .max(MAX_SECTIONS_PER_EVENT);
export type SectionsSnapshot = z.infer<typeof SectionsSnapshot>;

export async function sectionsSnapshotTx(tx: TenantTx, eventId: string): Promise<SectionsSnapshot> {
  const rows = await tx
    .select()
    .from(eventSections)
    .where(eq(eventSections.eventId, eventId))
    .orderBy(asc(eventSections.position), asc(eventSections.createdAt));
  return SectionsSnapshot.parse(
    rows.map((r) => ({ kind: r.kind, title: r.title, visible: r.visible, content: r.content })),
  );
}

/** Create the snapshot's sections on a new event, positions 0..n-1. */
export async function insertSectionsTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  sections: SectionsSnapshot,
): Promise<void> {
  if (sections.length === 0) return;
  const orgId = requireOrg(ctx);
  const parsed = SectionsSnapshot.safeParse(sections);
  if (!parsed.success) throw new DomainError('validation_failed', 'Invalid sections', { field: 'sections' });
  await tx.insert(eventSections).values(
    parsed.data.map((s, position) => ({
      orgId,
      eventId,
      kind: s.kind,
      title: s.title,
      content: s.content,
      visible: s.visible,
      position,
    })),
  );
}
