import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import {
  type AgencyClientGrant,
  agencyClientGrantsTx,
  organizationBrandTx,
  platformFlagTx,
} from '@yayatoh/tenancy';

/**
 * Agency v2 is behind the platform switch `agency_v2` (P6-8: "v2 behind a flag"; staff change it
 * through `platform.set_flag`). Every command checks it inside its transaction.
 */
export async function requireAgencyV2Tx(tx: TenantTx): Promise<void> {
  if (!(await platformFlagTx(tx, 'agency_v2')))
    throw new DomainError('module_not_enabled', 'Agency v2 is not switched on', { module: 'agency_v2' });
}

/** Is agency v2 switched on (pages and nav)? */
export function agencyV2Enabled(): Promise<boolean> {
  return withoutTenant((tx) => platformFlagTx(tx, 'agency_v2'));
}

/** The signed-in user behind a command (agency v2 actions are people's, never keys'). */
export function userOf(ctx: Ctx): string {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'Only a person can do this');
  return ctx.actor.userId;
}

/** The live grants a client gave the current (agency) org, by client id. */
export async function liveClientsTx(tx: TenantTx): Promise<Map<string, AgencyClientGrant>> {
  return new Map((await agencyClientGrantsTx(tx)).map((g) => [g.clientOrgId, g]));
}

/** One client's live grant to the current agency, or `not_found` (revoked, detached, never given). */
export async function liveClientTx(tx: TenantTx, clientOrgId: string): Promise<AgencyClientGrant> {
  const g = (await liveClientsTx(tx)).get(clientOrgId);
  if (!g) throw new DomainError('not_found', 'Client not found', { field: 'clientOrgId' });
  return g;
}

/** The agency's own name (a suffix for copies whose name the client already uses). */
export async function agencyNameTx(tx: TenantTx, agencyOrgId: string): Promise<string> {
  return (await organizationBrandTx(tx, agencyOrgId))?.name ?? 'Agency';
}

/**
 * The context in which the agency user acts in a client: the same person, through the client's
 * live grant. The client's own authorizer then applies the grant's role (and the team and day-of
 * rules) and every audit row in the client names the agency and the grant.
 */
export function viaGrantCtx(
  ctx: Ctx,
  grant: { grantId: string; clientOrgId: string },
  idempotencyKey: string | null = null,
): Ctx {
  return createCtx({
    orgId: grant.clientOrgId,
    actor: ctx.actor,
    locale: ctx.locale,
    now: ctx.now,
    requestId: ctx.requestId,
    idempotencyKey,
    viaAgency: { grantId: grant.grantId, agencyOrgId: requireOrg(ctx) },
  });
}

/** A system actor of the client org (agency v2 writes the client's staff rows and handovers). */
export function clientSystemCtx(clientOrgId: string, name: string, now: Date): Ctx {
  return createCtx({ orgId: clientOrgId, actor: { type: 'system', name }, now });
}

/** The agency a client-side command is acting for (only an agency acting through its grant). */
export function actingAgency(ctx: Ctx): { agencyOrgId: string; grantId: string } {
  if (!ctx.viaAgency)
    throw new DomainError('forbidden', 'Only an agency acting through its access can do this');
  return ctx.viaAgency;
}
