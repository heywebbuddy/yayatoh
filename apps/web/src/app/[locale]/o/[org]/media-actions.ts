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
 * U10: put a library image in the place an upload ticket names (the same ticket the uploader got:
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
  const sourceAssetId = String(form.get('sourceAssetId') ?? '');
  if (!sourceAssetId)
    return { ok: false, code: 'validation_failed', fields: ['sourceAssetId'], reason: 'no_choice' };
  try {
    await reuseMedia(
      data.ctx,
      {
        sourceAssetId,
        target: { ownerType: t.ownerType, ownerId: t.ownerId, slot: t.slot } as never,
        alt: String(form.get('alt') ?? '').trim() || null,
        decorative: form.get('decorative') === '1',
        replaceAssetId: String(form.get('replaceAssetId') ?? '') || null,
      },
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/', 'layout');
  return success();
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
