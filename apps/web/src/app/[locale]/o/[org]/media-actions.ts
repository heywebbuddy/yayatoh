'use server';

import { executeCommand } from '@yayatoh/kernel';
import { removeMedia, updateLogoAltCommand, updateMediaAltCommand } from '@yayatoh/media';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

type Family = 'content' | 'logo';

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

/** Change an image's alt text, or mark it decorative (never the logo). */
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
    await executeCommand(
      family === 'logo' ? updateLogoAltCommand : updateMediaAltCommand,
      { assetId, alt, decorative: family === 'logo' ? false : decorative },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/', 'layout');
  return success();
}
