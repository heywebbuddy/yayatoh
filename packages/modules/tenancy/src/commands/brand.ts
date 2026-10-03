import type { TenantTx } from '@yayatoh/db';
import { DomainError, type DomainEvent } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import { organizations } from '../schema.ts';
import { markOnboardingStepTx } from './onboarding.ts';

/**
 * Set the current org's brand colour inside its transaction (M6.8b: applying a brand kit the
 * client received from its agency). Same effects as `tenancy.updateOrganization` with a colour.
 */
export async function setBrandColorTx(
  tx: TenantTx,
  orgId: string,
  brandColor: string,
  now: Date,
  emit: (e: DomainEvent) => void,
): Promise<void> {
  if (!/^#[0-9a-f]{6}$/.test(brandColor)) throw new DomainError('validation_failed', 'Invalid colour');
  const [row] = await tx
    .update(organizations)
    .set({ brandColor, updatedAt: now })
    .where(eq(organizations.id, orgId))
    .returning({ id: organizations.id });
  if (!row) throw new DomainError('not_found');
  await markOnboardingStepTx(tx, 'brand', now);
  emit({
    type: 'organization.updated',
    version: 1,
    aggregateType: 'organization',
    aggregateId: orgId,
    payload: { orgId, fields: ['brandColor'] },
  });
}

/** The current org's kind (`organizer`, `agency`, …), or null (M6.8b: agency-only commands). */
export async function organizationKindTx(tx: TenantTx, orgId: string): Promise<string | null> {
  const [row] = await tx
    .select({ kind: organizations.kind })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row?.kind ?? null;
}
