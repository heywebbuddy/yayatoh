import {
  completeGalleryUploadCommand,
  completeGuestGalleryUploadCommand,
  directUploadTarget,
  requestGalleryUploadCommand,
  requestGuestGalleryUploadCommand,
  runGalleryCommand,
  saveGallerySettingsCommand,
  storeDirectUpload,
} from '@yayatoh/gallery';
import { unlockGuestSiteQuery } from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { ports } from './ports.ts';

/**
 * M4.5b helpers: what a browser does with an upload slot (the PUT straight to storage, here the
 * dev store's direct-upload route), and the guest's site access proof.
 */
export async function putToSlot(url: string, bytes: Uint8Array): Promise<boolean> {
  const token = url.split('/').pop() ?? '';
  const target = directUploadTarget(token);
  if (!target) return false;
  return storeDirectUpload(target, bytes);
}

/** The access proof a guest's browser holds after typing the site's password. */
export async function guestSiteAccess(orgId: string, eventId: string, password: string): Promise<string> {
  const { access } = await executeQuery(
    unlockGuestSiteQuery,
    { eventId, password },
    createCtx({ orgId }),
    ports,
  );
  if (!access) throw new Error('guestSiteAccess: wrong password');
  return access;
}

/** A host's photo: slot, PUT, complete (published at once). */
export async function hostGalleryPhoto(
  ctx: Ctx,
  eventId: string,
  bytes: Uint8Array,
  caption: string | null = null,
) {
  const slot = await executeCommand(
    requestGalleryUploadCommand,
    { eventId, bytes: bytes.byteLength, caption },
    ctx,
    ports,
  );
  if (!(await putToSlot(slot.url, bytes))) throw new Error('hostGalleryPhoto: PUT refused');
  return runGalleryCommand(completeGalleryUploadCommand, { eventId, itemId: slot.itemId }, ctx, ports);
}

/** A guest's photo: slot (with their name), PUT, complete. Returns the uploader cookie too. */
export async function guestGalleryPhoto(
  orgId: string,
  g: { eventId: string; access: string; uploader?: string | null; name?: string | null },
  bytes: Uint8Array,
  caption: string | null = null,
) {
  const ctx = createCtx({ orgId });
  const slot = await executeCommand(
    requestGuestGalleryUploadCommand,
    {
      eventId: g.eventId,
      access: g.access,
      uploader: g.uploader ?? null,
      name: g.name ?? null,
      bytes: bytes.byteLength,
      caption,
    },
    ctx,
    ports,
  );
  if (!(await putToSlot(slot.url, bytes))) throw new Error('guestGalleryPhoto: PUT refused');
  const done = await runGalleryCommand(
    completeGuestGalleryUploadCommand,
    { eventId: g.eventId, access: g.access, uploader: slot.uploader, itemId: slot.itemId },
    ctx,
    ports,
  );
  return { ...done, uploader: slot.uploader };
}

export async function enableGallery(
  ctx: Ctx,
  eventId: string,
  opts: {
    moderation?: 'hold' | 'auto';
    capBytes?: number | null;
    guestQuotaBytes?: number | null;
    guestQuotaItems?: number | null;
  } = {},
) {
  return executeCommand(
    saveGallerySettingsCommand,
    {
      eventId,
      enabled: true,
      moderation: opts.moderation ?? 'hold',
      capBytes: opts.capBytes ?? null,
      guestQuotaBytes: opts.guestQuotaBytes ?? null,
      guestQuotaItems: opts.guestQuotaItems ?? null,
    },
    ctx,
    ports,
  );
}
