'use server';

import {
  addGalleryVideoCommand,
  completeGalleryUploadCommand,
  hostSlidesQuery,
  moderateGalleryCommand,
  purgeExpiredGalleryUploads,
  removeGalleryItemCommand,
  requestGalleryUploadCommand,
  runGalleryCommand,
  saveGallerySettingsCommand,
} from '@yayatoh/gallery';
import { executeCommand, executeQuery, isDomainError, requireOrg } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { DoneResult, PhotoView, SlotResult } from '@/components/gallery/types.ts';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * The gallery's host tools (M4.5b). Every write goes through a gallery command (`guests:write`),
 * so a viewer posting a form or calling an action is refused by the server, not only by the
 * missing control.
 */
type State = ProgramFormState;

const MB = 1024 * 1024;
const bytesOf = (mb: number | null) =>
  mb === null ? null : Number.isFinite(mb) ? Math.round(mb * MB) : Number.NaN;

async function run(
  org: string,
  event: string,
  write: (eventId: string, ctx: Parameters<typeof executeCommand>[2]) => Promise<unknown>,
  fieldOf: (field: string) => string = (f) => f,
): Promise<State> {
  const { data, event: ev } = await loadEvent(org, event, 'gallery');
  try {
    await write(ev.id, data.ctx);
  } catch (err) {
    const state = failure(err);
    return state.fields ? { ...state, fields: state.fields.map(fieldOf) } : state;
  }
  revalidatePath(`/o/${org}/e/${event}/gallery`);
  return success();
}

const SETTING_FIELDS: Readonly<Record<string, string>> = {
  capBytes: 'capMb',
  guestQuotaBytes: 'guestQuotaMb',
};

export async function saveSettingsAction(org: string, event: string, _p: State, form: FormData) {
  return run(
    org,
    event,
    (eventId, ctx) =>
      executeCommand(
        saveGallerySettingsCommand,
        {
          eventId,
          enabled: form.get('enabled') === 'on',
          moderation: String(form.get('moderation') ?? 'hold'),
          capBytes: bytesOf(numberOrNull(form, 'capMb')),
          guestQuotaBytes: bytesOf(numberOrNull(form, 'guestQuotaMb')),
          guestQuotaItems: numberOrNull(form, 'guestQuotaItems'),
        },
        ctx,
        ports,
      ),
    (f) => SETTING_FIELDS[f] ?? f,
  );
}

export async function addVideoAction(org: string, event: string, _p: State, form: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      addGalleryVideoCommand,
      { eventId, url: String(form.get('url') ?? ''), caption: textOrNull(form, 'caption') },
      ctx,
      ports,
    ),
  );
}

export async function moderateAction(
  org: string,
  event: string,
  itemIds: string[],
  decision: 'approve' | 'reject',
  _p: State,
  _f: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    runGalleryCommand(moderateGalleryCommand, { eventId, itemIds, decision }, ctx, ports),
  );
}

export async function removeItemAction(org: string, event: string, itemId: string, _p: State, _f: FormData) {
  return run(org, event, (eventId, ctx) =>
    runGalleryCommand(removeGalleryItemCommand, { eventId, itemId }, ctx, ports),
  );
}

const refusal = (err: unknown) => {
  if (!isDomainError(err)) throw err;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return { ok: false as const, code: err.code, ...(typeof reason === 'string' ? { reason } : {}) };
};

/** A host's upload slot: the browser then PUTs the photo straight to storage. */
export async function requestUploadAction(
  org: string,
  event: string,
  meta: { bytes: number; caption: string | null; name: string | null },
): Promise<SlotResult> {
  const { data, event: ev } = await loadEvent(org, event, 'gallery');
  try {
    await purgeExpiredGalleryUploads(requireOrg(data.ctx), ev.id);
    const slot = await executeCommand(
      requestGalleryUploadCommand,
      { eventId: ev.id, bytes: meta.bytes, caption: meta.caption },
      data.ctx,
      ports,
    );
    return { ok: true, itemId: slot.itemId, url: slot.url, headers: slot.headers };
  } catch (err) {
    return refusal(err);
  }
}

export async function completeUploadAction(org: string, event: string, itemId: string): Promise<DoneResult> {
  const { data, event: ev } = await loadEvent(org, event, 'gallery');
  try {
    const r = await runGalleryCommand(
      completeGalleryUploadCommand,
      { eventId: ev.id, itemId },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/gallery`);
    return { ok: true, status: r.status, reason: r.reason };
  } catch (err) {
    return refusal(err);
  }
}

/** The slideshow's photos, re-read when the live feed says something changed. */
export async function hostSlidesAction(org: string, event: string): Promise<PhotoView[]> {
  const { data, event: ev } = await loadEvent(org, event, 'gallery');
  return (await executeQuery(hostSlidesQuery, { eventId: ev.id }, data.ctx, ports)).photos;
}
