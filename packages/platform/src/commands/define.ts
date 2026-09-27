import type { TenantTx } from '@yayatoh/db';
import {
  type Command,
  type CommandDefinition,
  defineCommand,
  defineQuery,
  type Query,
  type QueryDefinition,
} from '@yayatoh/kernel';

/** defineCommand with the handler's `tx` typed as a tenant transaction. */
export function tenantCommand<I, O, R>(
  def: CommandDefinition<I, O, R, TenantTx>,
): Command<I, O, R, TenantTx> {
  return defineCommand<I, O, R, TenantTx>(def);
}

/** defineQuery with the handler's `tx` typed as a tenant transaction. */
export function tenantQuery<I, O, R>(def: QueryDefinition<I, O, R, TenantTx>): Query<I, O, R, TenantTx> {
  return defineQuery<I, O, R, TenantTx>(def);
}
