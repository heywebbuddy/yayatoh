import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { actorNames } from './signup-codes.ts';
import type { Staff } from './staff.ts';

/** One change of the open-signup switch, for the history list (allowlisted columns). */
export interface OpenSignupChange {
  readonly id: string;
  readonly enabled: boolean;
  readonly changedBy: string;
  readonly reason: string;
  readonly at: Date;
}

export interface OpenSignupState {
  readonly enabled: boolean;
  readonly updatedAt: Date | null;
  readonly history: readonly OpenSignupChange[];
}

/** What staff give to flip the switch: a reason (kept in the history) and, to open, a confirmation. */
export const SetOpenSignupInput = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(3).max(500),
    confirm: z.boolean(),
  })
  .refine((v) => !v.enabled || v.confirm, { path: ['confirm'], message: 'confirm' });

/**
 * The open-signup switch (M3.11a) and its latest changes, read through platform_reader (logged in
 * the access log first). The staff member's name replaces `staff:<id>`.
 */
export async function openSignupState(staff: Staff): Promise<OpenSignupState> {
  const { flag, rows } = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: view open signup' },
    async (tx) => ({
      flag: await tx.execute<{ enabled: boolean; updated_at: string }>(
        sql`select enabled, updated_at from platform.flags where key = 'open_signup'`,
      ),
      rows: await tx.execute<{
        id: string;
        enabled: boolean;
        changed_by: string;
        reason: string;
        at: string;
      }>(
        sql`select id, enabled, changed_by, reason, at from platform.flag_changes
            where key = 'open_signup' order by at desc, id desc limit 50`,
      ),
    }),
  );
  const names = await actorNames([...new Set(rows.map((r) => r.changed_by))]);
  return {
    enabled: flag[0]?.enabled === true,
    updatedAt: flag[0] ? new Date(flag[0].updated_at) : null,
    history: rows.map((r) => ({
      id: r.id,
      enabled: r.enabled,
      changedBy: names.get(r.changed_by) ?? r.changed_by,
      reason: r.reason,
      at: new Date(r.at),
    })),
  };
}

/**
 * Open or close self-serve signup. Written through `platform.set_flag` (its own history row with
 * the reason) after the access-log row. True when this call changed the switch; false when it
 * already was in that state (a replayed form).
 */
export async function setOpenSignup(staff: Staff, enabled: boolean, reason: string): Promise<boolean> {
  const [row] = await withPlatformReader(
    {
      actor: staff.actor,
      reason: `staff console: ${enabled ? 'open' : 'close'} self-serve signup: ${reason}`,
    },
    (tx) =>
      tx.execute<{ changed: boolean }>(
        sql`select platform.set_flag('open_signup', ${enabled}, ${staff.actor}, ${reason}) as changed`,
      ),
    { callsWritingFunctions: true },
  );
  return row?.changed === true;
}
