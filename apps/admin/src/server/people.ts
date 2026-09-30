import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { addressHash, normalizeAddress } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import type { Staff } from './staff.ts';

/**
 * Controller-side DSAR lookup (M1.14e): what the platform holds about an email across
 * platform-level data. One audited platform_reader read (the access log names the staff member
 * and a masked address, never the address). Allowlisted results only: counts, roles, org names
 * and dates, never raw rows or secrets.
 */
export interface PersonLookup {
  readonly email: string;
  readonly account: {
    readonly name: string;
    readonly createdAt: Date;
    readonly twoFactor: boolean;
    readonly securityEvents: number;
    readonly sessions: number;
  } | null;
  readonly staffRole: string | null;
  readonly memberships: readonly { readonly org: string; readonly role: string }[];
  readonly invitations: readonly { readonly org: string; readonly role: string; readonly status: string }[];
  readonly orders: number;
  readonly signupCodes: number;
  readonly deletedAccounts: number;
  readonly erasedAt: Date | null;
  readonly requests: readonly {
    readonly kind: string;
    readonly actor: string;
    readonly reason: string | null;
    readonly at: Date;
  }[];
}

export const maskAddress = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};

export function hasAnything(p: PersonLookup): boolean {
  return Boolean(
    p.account || p.memberships.length || p.invitations.length || p.orders || p.signupCodes || p.staffRole,
  );
}

export async function lookupPerson(staff: Staff, rawEmail: string): Promise<PersonLookup> {
  const email = normalizeAddress(rawEmail);
  const hash = addressHash(email);
  return withPlatformReader(
    { actor: staff.actor, reason: `staff console: DSAR lookup ${maskAddress(email)}` },
    async (tx) => {
      const [user] = await tx.execute<{
        id: string;
        name: string;
        created_at: string;
        two_factor_enabled: boolean | null;
      }>(
        sql`select id, name, created_at, two_factor_enabled from auth.users
            where lower(email) = ${email} and deleted_at is null`,
      );
      const uid = user?.id ?? null;
      const [counts] = await tx.execute<{
        events: number;
        sessions: number;
        orders: number;
        codes: number;
        deleted: number;
      }>(sql`select
          (select count(*)::int from auth.security_events where user_id = ${uid}::uuid) as events,
          (select count(*)::int from auth.sessions where user_id = ${uid}::uuid and expires_at > now()) as sessions,
          (select count(*)::int from orders.orders
             where buyer_email = ${email} or (${uid}::uuid is not null and buyer_user_id = ${uid}::uuid)) as orders,
          platform.signup_code_mentions(${email}, ${uid ? `staff:${uid}` : null}) as codes,
          (select count(*)::int from auth.users where email like ${`${hash}+%`}) as deleted`);
      const [staffRow] = uid
        ? await tx.execute<{ role: string }>(
            sql`select role from platform.staff where user_id = ${uid}::uuid and revoked_at is null`,
          )
        : [];
      const memberships = uid
        ? await tx.execute<{ org: string; role: string }>(
            sql`select o.name as org, m.role from tenancy.memberships m
                join tenancy.organizations o on o.id = m.org_id where m.user_id = ${uid}::uuid order by o.name`,
          )
        : [];
      const invitations = await tx.execute<{ org: string; role: string; status: string }>(
        sql`select o.name as org, i.role,
              case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
                   when i.expires_at <= now() then 'expired' else 'pending' end as status
            from tenancy.invitations i join tenancy.organizations o on o.id = i.org_id
            where i.email = ${email} order by i.created_at`,
      );
      const [erased] = await tx.execute<{ erased_at: string }>(
        sql`select erased_at from platform.erased_address_lookup(${sql.raw(`ARRAY['${hash}']::text[]`)})`,
      );
      const requests = await tx.execute<{
        kind: string;
        actor: string;
        reason: string | null;
        created_at: string;
      }>(
        sql`select kind, actor, reason, created_at from privacy.account_requests
            where subject_ref = ${hash} order by created_at desc limit 20`,
      );
      return {
        email,
        account: user
          ? {
              name: user.name,
              createdAt: new Date(user.created_at),
              twoFactor: Boolean(user.two_factor_enabled),
              securityEvents: counts?.events ?? 0,
              sessions: counts?.sessions ?? 0,
            }
          : null,
        staffRole: staffRow?.role ?? null,
        memberships: [...memberships].map((m) => ({ org: m.org, role: m.role })),
        invitations: [...invitations].map((i) => ({ org: i.org, role: i.role, status: i.status })),
        orders: counts?.orders ?? 0,
        signupCodes: counts?.codes ?? 0,
        deletedAccounts: counts?.deleted ?? 0,
        erasedAt: erased ? new Date(erased.erased_at) : null,
        requests: [...requests].map((r) => ({
          kind: r.kind,
          actor: r.actor,
          reason: r.reason,
          at: new Date(r.created_at),
        })),
      };
    },
  );
}
