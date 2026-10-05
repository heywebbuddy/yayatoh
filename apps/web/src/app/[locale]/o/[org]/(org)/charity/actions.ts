'use server';

import { saveCharityProfileCommand } from '@yayatoh/donations';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadConsole } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** Save the charity profile (owners and admins); any change goes to staff review again. */
export async function saveCharityAction(
  org: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      saveCharityProfileCommand,
      {
        legalName: String(form.get('legalName') ?? ''),
        ein: String(form.get('ein') ?? ''),
        exemptKind: String(form.get('exemptKind') ?? '501c3') as '501c3',
        sponsorName: textOrNull(form, 'sponsorName'),
        sponsorEin: textOrNull(form, 'sponsorEin'),
        address: textOrNull(form, 'address'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/charity`);
  return success();
}
