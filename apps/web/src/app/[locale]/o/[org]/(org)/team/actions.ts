'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  changeMemberRoleCommand,
  inviteMemberCommand,
  removeMemberCommand,
  revokeInvitationCommand,
} from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface ActionState {
  readonly ok: boolean;
  readonly code: string | null;
  /** M4.2a: `pending_invitation` when the address already has one pending in this org. */
  readonly reason?: string;
}

/** Server Actions share the command pipeline with /v1: authz, audit and outbox happen in the command. */
export async function inviteAction(org: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      inviteMemberCommand,
      { email: String(form.get('email') ?? ''), role: String(form.get('role') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/team`);
  return { ok: true, code: null };
}

export async function revokeAction(org: string, invitationId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(revokeInvitationCommand, { invitationId }, data.ctx, ports);
  revalidatePath(`/o/${org}/team`);
}

export interface MemberState {
  readonly ok: boolean;
  readonly code: string | null;
  /** `last_owner`, `owner_only`: why a change was refused. */
  readonly reason?: string;
  readonly stamp?: number;
}

const refusal = (err: unknown): MemberState => {
  if (!isDomainError(err)) throw err;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return { ok: false, code: err.code, ...(typeof reason === 'string' ? { reason } : {}) };
};

/** Change a member's role (M1.2c leftover): step-up, owners only for ownership, never the last owner. */
export async function changeRoleAction(
  org: string,
  userId: string,
  _prev: MemberState,
  form: FormData,
): Promise<MemberState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      changeMemberRoleCommand,
      { userId, role: String(form.get('role') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return refusal(err);
  }
  revalidatePath(`/o/${org}/team`);
  return { ok: true, code: null, stamp: Date.now() };
}

/** Remove a member (M1.2c leftover): step-up and a confirmation; never the last owner. */
export async function removeMemberAction(
  org: string,
  userId: string,
  _prev: MemberState,
  _form: FormData,
): Promise<MemberState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(removeMemberCommand, { userId }, data.ctx, ports);
  } catch (err) {
    return refusal(err);
  }
  revalidatePath(`/o/${org}/team`);
  return { ok: true, code: null, stamp: Date.now() };
}
