'use server';

import { executeCommand } from '@yayatoh/kernel';
import {
  deleteLibraryImage,
  type MediaFamily,
  removeMedia,
  reuseMedia,
  updateLogoAltCommand,
  updateMediaAltCommand,
  updateProgramImageAlt,
  verifyUploadTicket,
} from '@yayatoh/media';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { libraryPage } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';

type Family = MediaFamily;

/** Remove an image (M1.4e): its rows, variants and files. The command authorizes. */
export async function removeMediaAction(
  org: string,
  assetId: string,
  family: Family,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await removeMedia(data.ctx, { assetId }, ports, family);
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/', 'layout');
  return success();
}

/** Change an image's alt text, or mark it decorative (never the logo or a program image). */
export async function updateMediaAltAction(
  org: string,
  assetId: string,
  family: Family,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const alt = String(form.get('alt') ?? '').trim() || null;
  const decorative = form.get('decorative') === '1';
  try {
    if (family === 'logo' || family === 'content')
      await executeCommand(
        family === 'logo' ? updateLogoAltCommand : updateMediaAltCommand,
        { assetId, alt, decorative: family === 'logo' ? false : decorative },
        data.ctx,
        ports,
      );
    // Speaker photos, exhibitor and sponsor logos are always described (M1.4h).
    else await updateProgramImageAlt(family, { assetId, alt }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/', 'layout');
  return success();
}

/** U10: the library images offered in a picker (originals, newest first). */
export async function pickerLibraryAction(org: string): Promise<{
  ok: boolean;
  items: {
    id: string;
    alt: string | null;
    decorative: boolean;
    preview: string;
    width: number;
    height: number;
    uses: number;
  }[];
}> {
  const data = await loadConsole(org);
  const page = await libraryPage(data, { page: 1, unusedOnly: false, perPage: 200 });
  return {
    ok: true,
    items: page.items.map((i) => ({
      id: i.id,
      alt: i.alt,
      decorative: i.decorative,
      preview: i.preview,
      width: i.width,
      height: i.height,
      uses: i.usedIn.length,
    })),
  };
}

/**
 * U10: put one or more library images in the place an upload ticket names (the same ticket the uploader got:
 * it was signed for this member, org, owner and slot). Nothing is uploaded or stored again.
 */
export async function reuseFromLibraryAction(
  org: string,
  ticket: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const t = verifyUploadTicket(ticket);
  if (!t || t.userId !== data.session.userId || t.orgId !== data.org.id)
    return { ok: false, code: 'forbidden' };
  if (t.ownerType === 'library' || t.slot === 'floorplan') return { ok: false, code: 'validation_failed' };
  // One image, or several at once (each with its own `alt:<id>`; one image uses `alt`).
  const ids = [...new Set(form.getAll('sourceAssetId').map(String).filter(Boolean))];
  if (!ids.length)
    return { ok: false, code: 'validation_failed', fields: ['sourceAssetId'], reason: 'no_choice' };
  const decorative = form.get('decorative') === '1';
  const replaceAssetId = ids.length === 1 ? String(form.get('replaceAssetId') ?? '') || null : null;
  const altOf = (id: string) => String(form.get(`alt:${id}`) ?? form.get('alt') ?? '').trim() || null;
  const undescribed = decorative ? [] : ids.filter((id) => !altOf(id));
  if (undescribed.length)
    return {
      ok: false,
      code: 'validation_failed',
      fields: ids.length === 1 ? ['alt'] : undescribed.map((id) => `alt:${id}`),
    };
  let skipped = 0;
  for (const sourceAssetId of ids) {
    try {
      await reuseMedia(
        data.ctx,
        {
          sourceAssetId,
          target: { ownerType: t.ownerType, ownerId: t.ownerId, slot: t.slot } as never,
          alt: altOf(sourceAssetId),
          decorative,
          replaceAssetId,
        },
        ports,
      );
    } catch (err) {
      const state = failure(err);
      // With several images, one that is already here is skipped rather than stopping the rest.
      if (ids.length > 1 && state.reason === 'already_here') skipped += 1;
      else {
        if (sourceAssetId !== ids[0]) revalidatePath('/', 'layout');
        return state;
      }
    }
  }
  revalidatePath('/', 'layout');
  if (skipped === ids.length) return { ok: false, code: 'conflict', reason: 'already_here' };
  if (skipped) return { ...success(), reason: 'partly_here' };
  return ids.length > 1 ? { ...success(), reason: 'placed_many' } : success();
}

/** U10: delete an image from the library (only when it is used nowhere). */
export async function deleteLibraryImageAction(
  org: string,
  assetId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await deleteLibraryImage(data.ctx, { assetId }, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/media`);
  return success();
}
