'use server';

import {
  addGuestGalleryVideoCommand,
  completeGuestGalleryUploadCommand,
  publicSlidesQuery,
  purgeExpiredGalleryUploads,
  removeOwnGalleryItemCommand,
  requestGuestGalleryUploadCommand,
  runGalleryCommand,
} from '@yayatoh/gallery';
import { guestSiteTarget } from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';
import type { DoneResult, PhotoView, SlotResult } from '@/components/gallery/types.ts';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';
import { siteAccess } from '../access.ts';

/**
 * A guest's gallery actions (M4.5b). The org and event come from the guest site's address
 * (server-side lookup), never from input; the site's access cookie proves the password; the
 * uploader cookie (httpOnly, per site) keeps the guest's quota and their own photos together.
 * Uploads and links are rate-limited per device, address and site (`galleryUpload`).
 */
const uploaderCookie = (code: string) => `yy_gal_${code}`;

async function guestOf(raw: string) {
  const code = raw.toUpperCase();
  const target = await guestSiteTarget(code);
  if (!target) return null;
  const jar = await cookies();
  return {
    code,
    ...target,
    access: await siteAccess(code),
    uploader: jar.get(uploaderCookie(code))?.value ?? null,
    ctx: createCtx({ orgId: target.orgId, locale: await getLocale() }),
  };
}

async function rememberUploader(code: string, token: string | null) {
  if (!token) return;
  (await cookies()).set(uploaderCookie(code), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
}

const refusal = (err: unknown) => {
  if (!isDomainError(err)) throw err;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return { ok: false as const, code: err.code, ...(typeof reason === 'string' ? { reason } : {}) };
};

const closed = { ok: false as const, code: 'not_found' };
const limited = { ok: false as const, code: 'rate_limited', reason: 'rate_limited' };

export async function requestGuestUploadAction(
  code: string,
  meta: { bytes: number; caption: string | null; name: string | null },
): Promise<SlotResult> {
  const g = await guestOf(code);
  if (!g) return closed;
  if (!(await limitAction('galleryUpload', { identity: g.code, scope: 'site' })).allowed) return limited;
  try {
    await purgeExpiredGalleryUploads(g.orgId, g.eventId);
    const slot = await executeCommand(
      requestGuestGalleryUploadCommand,
      {
        eventId: g.eventId,
        access: g.access,
        uploader: g.uploader,
        name: meta.name,
        bytes: meta.bytes,
        caption: meta.caption,
      },
      g.ctx,
      ports,
    );
    await rememberUploader(g.code, slot.uploader);
    return { ok: true, itemId: slot.itemId, url: slot.url, headers: slot.headers };
  } catch (err) {
    return refusal(err);
  }
}

export async function completeGuestUploadAction(code: string, itemId: string): Promise<DoneResult> {
  const g = await guestOf(code);
  if (!g) return closed;
  try {
    const r = await runGalleryCommand(
      completeGuestGalleryUploadCommand,
      { eventId: g.eventId, access: g.access, uploader: g.uploader, itemId },
      g.ctx,
      ports,
    );
    revalidatePath(`/w/${g.code}/gallery`);
    return { ok: true, status: r.status, reason: r.reason };
  } catch (err) {
    return refusal(err);
  }
}

type State = ProgramFormState;

export async function addGuestVideoAction(code: string, _p: State, form: FormData): Promise<State> {
  const g = await guestOf(code);
  if (!g) return { ok: false, code: 'not_found' };
  if (!(await limitAction('galleryUpload', { identity: g.code, scope: 'site' })).allowed)
    return { ok: false, code: 'rate_limited' };
  try {
    const r = await executeCommand(
      addGuestGalleryVideoCommand,
      {
        eventId: g.eventId,
        access: g.access,
        uploader: g.uploader,
        name: textOrNull(form, 'name'),
        url: String(form.get('url') ?? ''),
        caption: textOrNull(form, 'caption'),
      },
      g.ctx,
      ports,
    );
    await rememberUploader(g.code, r.uploader);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/w/${g.code}/gallery`);
  return success();
}

export async function removeOwnItemAction(
  code: string,
  itemId: string,
  _p: State,
  _f: FormData,
): Promise<State> {
  const g = await guestOf(code);
  if (!g) return { ok: false, code: 'not_found' };
  try {
    await runGalleryCommand(
      removeOwnGalleryItemCommand,
      { eventId: g.eventId, access: g.access, uploader: g.uploader, itemId },
      g.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/w/${g.code}/gallery`);
  return success();
}

/** The slideshow's photos for a guest past the password (re-read on each live message). */
export async function guestSlidesAction(code: string): Promise<PhotoView[]> {
  const g = await guestOf(code);
  if (!g) return [];
  try {
    return (await executeQuery(publicSlidesQuery, { eventId: g.eventId, access: g.access }, g.ctx, ports))
      .photos;
  } catch (err) {
    if (isDomainError(err)) return [];
    throw err;
  }
}
