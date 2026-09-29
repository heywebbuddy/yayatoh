'use server';

import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  moveGuestCommand,
  parseTags,
  removePartyCommand,
  removePartyGuestCommand,
  updatePartyCommand,
  updatePartyGuestCommand,
} from '@yayatoh/guests';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * Guests page (M4.1a) actions. Every write goes through a guests command (`guests:write`), so
 * a viewer submitting an open form is refused by the server, not just the missing button.
 */
type State = ProgramFormState;

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/guests`);
const text = (form: FormData, key: string) => String(form.get(key) ?? '');
const checked = (form: FormData, key: string) => form.get(key) === '1';
const source = (form: FormData) => (form.get('source') === 'paper' ? 'paper' : 'manual');

const partyFields = (form: FormData) => ({
  name: text(form, 'name'),
  envelopeName: textOrNull(form, 'envelopeName'),
  side: textOrNull(form, 'side'),
  vip: checked(form, 'vip'),
  tags: parseTags(text(form, 'tags')),
  notes: text(form, 'notes'),
  source: source(form),
});

const guestFields = (form: FormData) => ({
  firstName: textOrNull(form, 'firstName'),
  lastName: textOrNull(form, 'lastName'),
  ageClass: text(form, 'ageClass') || 'adult',
  meal: textOrNull(form, 'meal'),
  dietary: textOrNull(form, 'dietary'),
  accessibility: textOrNull(form, 'accessibility'),
  address: textOrNull(form, 'address'),
  attendeeId: textOrNull(form, 'attendeeId'),
  isPrimary: checked(form, 'isPrimary'),
  source: source(form),
});

async function run(
  org: string,
  event: string,
  write: (eventId: string, ctx: Parameters<typeof executeCommand>[2]) => Promise<unknown>,
): Promise<State> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  try {
    await write(ev.id, data.ctx);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function createPartyAction(org: string, event: string, _prev: State, form: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(createPartyCommand, { eventId, ...partyFields(form) }, ctx, ports),
  );
}

export async function updatePartyAction(
  org: string,
  event: string,
  partyId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(updatePartyCommand, { eventId, partyId, ...partyFields(form) }, ctx, ports),
  );
}

export async function removePartyAction(
  org: string,
  event: string,
  partyId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(removePartyCommand, { eventId, partyId, source: source(form) }, ctx, ports),
  );
}

export async function addGuestAction(
  org: string,
  event: string,
  partyId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(addPartyGuestCommand, { eventId, partyId, ...guestFields(form) }, ctx, ports),
  );
}

export async function updateGuestAction(
  org: string,
  event: string,
  guestId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(updatePartyGuestCommand, { eventId, guestId, ...guestFields(form) }, ctx, ports),
  );
}

export async function addPlusOneAction(
  org: string,
  event: string,
  hostGuestId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      addPlusOneCommand,
      {
        eventId,
        hostGuestId,
        firstName: textOrNull(form, 'firstName'),
        lastName: textOrNull(form, 'lastName'),
        source: source(form),
      },
      ctx,
      ports,
    ),
  );
}

export async function moveGuestAction(
  org: string,
  event: string,
  guestId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      moveGuestCommand,
      { eventId, guestId, toPartyId: text(form, 'toPartyId'), source: source(form) },
      ctx,
      ports,
    ),
  );
}

export async function removeGuestAction(
  org: string,
  event: string,
  guestId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(removePartyGuestCommand, { eventId, guestId, source: source(form) }, ctx, ports),
  );
}
