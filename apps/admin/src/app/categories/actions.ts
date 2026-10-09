'use server';

import { isUniqueViolation } from '@yayatoh/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  CreatePlatformCategoryInput,
  createPlatformCategory,
  moveKey,
  parseDefaultKeys,
  savePlatformDefaults,
} from '@/server/platform-categories.ts';
import { requireStaff } from '@/server/staff.ts';

/**
 * U8: save the platform default category list (admins only). The form posts every key in its
 * shown order and the ticked ones; a move button saves with that one step applied. The outcome
 * comes back in the address (`done` or `error`).
 */
export async function savePlatformCategoriesAction(form: FormData) {
  const staff = await requireStaff('categories');
  const order = form.getAll('key').map(String);
  const included = new Set(form.getAll('include').map(String));
  let keys = order.filter((k) => included.has(k));
  const move = /^(up|down):([a-z][a-z0-9_]{0,59})$/.exec(String(form.get('move') ?? ''));
  if (move) keys = moveKey(keys, move[2] as string, move[1] as 'up' | 'down');
  const parsed = parseDefaultKeys(keys);
  if (!parsed) redirect('/categories?error=empty');
  await savePlatformDefaults(staff.actor, parsed);
  revalidatePath('/categories');
  redirect(`/categories?done=${move ? 'moved' : 'saved'}${move ? `&focus=${move[1]}:${move[2]}` : ''}`);
}

export async function createPlatformCategoryAction(
  _state: string | null,
  form: FormData,
): Promise<string | null> {
  const staff = await requireStaff('categories');
  const parsed = CreatePlatformCategoryInput.safeParse({
    key: String(form.get('key') ?? '').trim(),
    label: String(form.get('label') ?? ''),
    include: form.get('include') === 'on',
  });
  if (!parsed.success) return 'invalid';
  try {
    await createPlatformCategory(staff.actor, parsed.data);
  } catch (error) {
    if (isUniqueViolation(error)) return 'duplicate';
    throw error;
  }
  revalidatePath('/categories');
  redirect('/categories?done=created');
}
