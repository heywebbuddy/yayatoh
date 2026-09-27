'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { inviteMemberCommand, revokeInvitationCommand } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface ActionState {
  readonly ok: boolean;
  readonly code: string | null;
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
