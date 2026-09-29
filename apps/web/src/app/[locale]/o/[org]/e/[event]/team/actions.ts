'use server';

import {
  changeTeamRoleCommand,
  inviteTeamMemberCommand,
  removeTeamMemberCommand,
  revokeTeamInvitationCommand,
} from '@yayatoh/events';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ActionState, MemberState } from '@/app/[locale]/o/[org]/(org)/team/actions.ts';
import type { StepUpActionResult } from '@/components/step-up.tsx';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * M4.2a: an event's team (co-hosts and planners). Each action runs the command pipeline, which
 * authorizes `event_team:manage` for this event (owners, admins, co-hosts), asks for step-up and
 * audits the change.
 */
const reasonOf = (err: unknown): { code: string; reason?: string } => {
  if (!isDomainError(err)) throw err;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return { code: err.code, ...(typeof reason === 'string' ? { reason } : {}) };
};

export async function inviteTeamAction(
  org: string,
  event: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { data, event: ev } = await loadEvent(org, event, 'team');
  try {
    await executeCommand(
      inviteTeamMemberCommand,
      { eventId: ev.id, email: String(form.get('email') ?? ''), role: String(form.get('role') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { ok: false, ...reasonOf(err) };
  }
  revalidatePath(`/o/${org}/e/${event}/team`);
  return { ok: true, code: null };
}

export async function revokeTeamInvitationAction(
  org: string,
  event: string,
  invitationId: string,
): Promise<StepUpActionResult> {
  const { data, event: ev } = await loadEvent(org, event, 'team');
  try {
    await executeCommand(revokeTeamInvitationCommand, { eventId: ev.id, invitationId }, data.ctx, ports);
  } catch (err) {
    return { code: reasonOf(err).code };
  }
  revalidatePath(`/o/${org}/e/${event}/team`);
  return undefined;
}

export async function changeTeamRoleAction(
  org: string,
  event: string,
  userId: string,
  _prev: MemberState,
  form: FormData,
): Promise<MemberState> {
  const { data, event: ev } = await loadEvent(org, event, 'team');
  try {
    await executeCommand(
      changeTeamRoleCommand,
      { eventId: ev.id, userId, role: String(form.get('role') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { ok: false, ...reasonOf(err) };
  }
  revalidatePath(`/o/${org}/e/${event}/team`);
  return { ok: true, code: null, stamp: Date.now() };
}

export async function removeTeamMemberAction(
  org: string,
  event: string,
  userId: string,
  _prev: MemberState,
  _form: FormData,
): Promise<MemberState> {
  const { data, event: ev } = await loadEvent(org, event, 'team');
  try {
    await executeCommand(removeTeamMemberCommand, { eventId: ev.id, userId }, data.ctx, ports);
  } catch (err) {
    return { ok: false, ...reasonOf(err) };
  }
  revalidatePath(`/o/${org}/e/${event}/team`);
  return { ok: true, code: null, stamp: Date.now() };
}
