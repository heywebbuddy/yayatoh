'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getAuth } from '@/server/auth.ts';
import { requireStaff } from '@/server/staff.ts';

/** Remove one of the signed-in staff member's own passkeys (Better Auth checks ownership). */
export async function deletePasskeyAction(
  _prev: { code: string | null },
  form: FormData,
): Promise<{ code: string | null }> {
  await requireStaff();
  try {
    await getAuth().api.deletePasskey({
      body: { id: String(form.get('id') ?? '').slice(0, 64) },
      headers: await headers(),
    });
  } catch {
    return { code: 'failed' };
  }
  revalidatePath('/security');
  return { code: 'deleted' };
}
