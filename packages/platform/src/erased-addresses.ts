import { createHash } from 'node:crypto';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';

/**
 * Platform-wide erased-address suppression (M1.14e). An erased person's address is kept only as
 * the SHA-256 of its normalized form, in the global `platform.erased_addresses` (reached through
 * SECURITY DEFINER functions only). The notifications dispatcher and contact imports of every org
 * consult it, so an erased address isn't mailed or re-added to a marketing list again.
 */

/** Unicode NFC, trimmed, lower-cased: the same key the CRM, DSAR records and invitations use. */
export function normalizeAddress(email: string): string {
  return email.normalize('NFC').trim().toLowerCase();
}

/** SHA-256 (hex) of the normalized address: what the suppression list and DSAR records keep. */
export function addressHash(email: string): string {
  return createHash('sha256').update(normalizeAddress(email), 'utf8').digest('hex');
}

export interface ErasedAddress {
  /** When the address was (last) erased. */
  readonly erasedAt: Date;
  /** The person signed up again after the erasure: account mail reaches them. */
  readonly accountLiftedAt: Date | null;
}

/** Put an address on the list (or renew it), inside the caller's transaction. */
export async function markAddressErasedTx(tx: TenantTx, email: string): Promise<void> {
  if (!normalizeAddress(email).includes('@')) return;
  await tx.execute(sql`select platform.erased_address_add(${addressHash(email)})`);
}

/** The erased addresses among `emails` (keyed by normalized address). */
export async function erasedAddressesTx(
  tx: TenantTx,
  emails: readonly string[],
): Promise<Map<string, ErasedAddress>> {
  const byHash = new Map<string, string>();
  for (const e of emails) {
    const norm = normalizeAddress(e);
    if (norm.includes('@')) byHash.set(addressHash(norm), norm);
  }
  const out = new Map<string, ErasedAddress>();
  const hashes = [...byHash.keys()];
  for (let i = 0; i < hashes.length; i += 1000) {
    const part = hashes.slice(i, i + 1000);
    const rows = await tx.execute<{
      address_hash: string;
      erased_at: string | Date;
      account_lifted_at: string | Date | null;
    }>(
      sql`select address_hash, erased_at, account_lifted_at from platform.erased_address_lookup(${sql.raw(
        `ARRAY[${part.map((h) => `'${h}'`).join(',')}]::text[]`,
      )})`,
    );
    for (const r of rows) {
      const norm = byHash.get(r.address_hash);
      if (norm)
        out.set(norm, {
          erasedAt: new Date(r.erased_at),
          accountLiftedAt: r.account_lifted_at ? new Date(r.account_lifted_at) : null,
        });
    }
  }
  return out;
}

/** One address's entry, or null when it was never erased. */
export async function erasedAddressTx(tx: TenantTx, email: string): Promise<ErasedAddress | null> {
  return (await erasedAddressesTx(tx, [email])).get(normalizeAddress(email)) ?? null;
}

/** Outside any tenant (sign-up, the account pages). */
export function erasedAddress(email: string): Promise<ErasedAddress | null> {
  return withoutTenant((tx) => erasedAddressTx(tx, email));
}

/**
 * The person signed up again (a new account with this address): account mail reaches them from
 * now on. Org marketing stays suppressed until that org records a new consent. Returns whether
 * an entry was lifted.
 */
export async function liftErasedAccountMail(email: string): Promise<boolean> {
  if (!normalizeAddress(email).includes('@')) return false;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ lifted: boolean }>(
      sql`select platform.erased_address_lift_account(${addressHash(email)}) as lifted`,
    ),
  );
  return Boolean(rows[0]?.lifted);
}

/** Mark erased outside any tenant (account deletion). */
export function markAddressErased(email: string): Promise<void> {
  return withoutTenant((tx) => markAddressErasedTx(tx, email));
}
