'use server';

import { executeCommand } from '@yayatoh/kernel';
import {
  assignBoothCommand,
  deleteBoothCommand,
  saveBoothCommand,
  unassignBoothCommand,
} from '@yayatoh/program';
import { revalidatePath, updateTag } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { scopeTag } from '@/lib/cache-keys.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** Booths and their exhibitors (M5.4a): forms first, so everything works by keyboard. */
function done(org: string, event: string, orgId: string) {
  revalidatePath(`/o/${org}/e/${event}/exhibitors/booths`);
  // The public exhibitor map (cached per org) shows the change.
  updateTag(scopeTag({ org: orgId }));
}

/** Metres (as typed) to whole centimetres; NaN when missing, so the command names the field. */
const cm = (form: FormData, key: string) => {
  const v = numberOrNull(form, key);
  return v === null ? Number.NaN : Math.round(v * 100);
};

export async function saveBoothAction(
  org: string,
  event: string,
  boothId: string | null,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      saveBoothCommand,
      {
        eventId: ev.id,
        ...(boothId ? { boothId } : {}),
        number: String(form.get('number') ?? ''),
        category: textOrNull(form, 'category'),
        width: cm(form, 'width'),
        height: cm(form, 'height'),
        x: cm(form, 'x'),
        y: cm(form, 'y'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event, data.org.id);
  // The page lists the plan's warnings (conflicts), with names, once it re-renders.
  return success();
}

export async function deleteBoothAction(org: string, event: string, boothId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteBoothCommand, { eventId: ev.id, boothId }, data.ctx, ports);
  done(org, event, data.org.id);
}

export async function assignBoothAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      assignBoothCommand,
      {
        eventId: ev.id,
        boothId: String(form.get('boothId') ?? ''),
        exhibitorId: String(form.get('exhibitorId') ?? ''),
        primary: form.get('primary') === '1',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event, data.org.id);
  // The page lists the plan's warnings (conflicts), with names, once it re-renders.
  return success();
}

/** Make an exhibitor the booth's primary (the old primary stays as a co-exhibitor). */
export async function makePrimaryAction(
  org: string,
  event: string,
  boothId: string,
  exhibitorId: string,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(
    assignBoothCommand,
    { eventId: ev.id, boothId, exhibitorId, primary: true },
    data.ctx,
    ports,
  );
  done(org, event, data.org.id);
}

export async function unassignBoothAction(
  org: string,
  event: string,
  boothId: string,
  exhibitorId: string,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(unassignBoothCommand, { eventId: ev.id, boothId, exhibitorId }, data.ctx, ports);
  done(org, event, data.org.id);
}

/**
 * Drag an exhibitor onto a booth on the map (a pointer shortcut; the assign form is the keyboard
 * way to do the same). Returns whether it worked; the page re-renders with the result.
 */
export async function dropAssignAction(
  org: string,
  event: string,
  boothId: string,
  exhibitorId: string,
): Promise<{ ok: boolean }> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(assignBoothCommand, { eventId: ev.id, boothId, exhibitorId }, data.ctx, ports);
  } catch (err) {
    failure(err);
    return { ok: false };
  }
  done(org, event, data.org.id);
  return { ok: true };
}
