'use server';

import {
  approveSubmissionCommand,
  type MergeChoice,
  mergeSubmissionCommand,
  rejectSubmissionCommand,
  setCollectorCommand,
} from '@yayatoh/guests';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * The contact collector's host tools (M4.1f). Every write goes through a guests command
 * (`guests:write`), so a viewer posting a form is refused by the server, not only by the missing
 * control.
 */
type State = ProgramFormState;

async function run<T>(
  org: string,
  event: string,
  write: (eventId: string, ctx: Parameters<typeof executeCommand>[2]) => Promise<T>,
  then?: (result: T) => string,
): Promise<State> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  let result: T;
  try {
    result = await write(ev.id, data.ctx);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/guests`, 'layout');
  // A decision removes the submission from the queue: the page says what happened.
  if (then)
    redirect({ href: `/o/${org}/e/${event}/guests/collector?${then(result)}`, locale: await getLocale() });
  return success();
}

export async function setCollectorAction(
  org: string,
  event: string,
  enabled: boolean,
  _p: State,
  _f: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(setCollectorCommand, { eventId, enabled }, ctx, ports),
  );
}

export async function approveSubmissionAction(
  org: string,
  event: string,
  id: string,
  _p: State,
  _f: FormData,
) {
  return run(
    org,
    event,
    (eventId, ctx) => executeCommand(approveSubmissionCommand, { eventId, submissionId: id }, ctx, ports),
    (r) => `done=approved&party=${r.partyId}`,
  );
}

export async function rejectSubmissionAction(
  org: string,
  event: string,
  id: string,
  _p: State,
  _f: FormData,
) {
  return run(
    org,
    event,
    (eventId, ctx) => executeCommand(rejectSubmissionCommand, { eventId, submissionId: id }, ctx, ports),
    () => 'done=rejected',
  );
}

const choice = (form: FormData, key: string): MergeChoice => (form.get(key) === 'use' ? 'use' : 'keep');

/** Field by field: keep the party's value or use the submitted one; add the ticked people. */
export async function mergeSubmissionAction(
  org: string,
  event: string,
  id: string,
  partyId: string,
  _p: State,
  form: FormData,
) {
  return run(
    org,
    event,
    (eventId, ctx) =>
      executeCommand(
        mergeSubmissionCommand,
        {
          eventId,
          submissionId: id,
          partyId,
          fields: {
            address: choice(form, 'address'),
            email: choice(form, 'email'),
            phone: choice(form, 'phone'),
          },
          addMembers: form
            .getAll('members')
            .map((v) => Number(v))
            .filter((n) => Number.isInteger(n)),
        },
        ctx,
        ports,
      ),
    (r) => `done=merged&party=${r.partyId}`,
  );
}
