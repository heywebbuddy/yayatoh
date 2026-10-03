import { type SegmentDefinition, usesMoneyConditions } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { memberRoleTx, roleCan } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

/**
 * M6.1b: an audience that filters on money (lifetime value, the RFM monetary quintile) may only
 * be previewed or saved by a member whose org role can read finance, so a role without it can't
 * learn what people spent by counting. System actors (campaign sends) are not members.
 */
export async function assertMoneyConditionsAllowedTx(tx: TenantTx, ctx: Ctx, def: SegmentDefinition) {
  if (!usesMoneyConditions(def) || ctx.actor.type === 'system') return;
  if (ctx.actor.type === 'user') {
    const role = await memberRoleTx(tx, ctx.actor.userId);
    if (role && roleCan(role, 'finance:read')) return;
  }
  throw new DomainError('forbidden', 'Lifetime value conditions need finance access', { reason: 'finance' });
}

/**
 * The same check where only the transaction is at hand (the bulk export's resolve step): the
 * member is the transaction's actor (`app.actor_id`, set from the context by `withTenant`).
 */
export async function assertMoneyConditionsAllowedForActorTx(tx: TenantTx, def: SegmentDefinition) {
  if (!usesMoneyConditions(def)) return;
  const [row] = await tx.execute<{ actor: string | null }>(
    sql`select nullif(current_setting('app.actor_id', true), '') as actor`,
  );
  if (row?.actor) {
    const role = await memberRoleTx(tx, row.actor);
    if (role && roleCan(role, 'finance:read')) return;
  }
  throw new DomainError('forbidden', 'Lifetime value conditions need finance access', { reason: 'finance' });
}
