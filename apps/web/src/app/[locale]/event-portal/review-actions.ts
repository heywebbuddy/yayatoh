'use server';

import { executeCommand } from '@yayatoh/kernel';
import { submitCfpReviewCommand } from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { failure, success } from '@/server/form.ts';
import { portalRequestCtx, requirePortalPrincipal } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';

/**
 * A call-for-papers reviewer's score and comment (M5.3b). The command runs as the signed-in
 * portal principal (`portal:cfp_reviewer`) and re-checks that the submission is assigned to them.
 */
export async function submitReviewAction(
  submissionId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  try {
    const principal = await requirePortalPrincipal();
    await executeCommand(
      submitCfpReviewCommand,
      {
        submissionId,
        score: Number(form.get('score') ?? 0),
        comment: String(form.get('comment') ?? ''),
      },
      await portalRequestCtx(principal),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath('/event-portal', 'layout');
  return success();
}
