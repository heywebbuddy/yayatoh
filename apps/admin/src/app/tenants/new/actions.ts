'use server';

import { isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { provisionTenant } from '@/server/provision-tenant.ts';
import { requireStaff } from '@/server/staff.ts';

export type CreateTenantState = { error: 'invalid' | 'owner' | 'slug' | 'failed' | null; fields?: string[] };

export async function createTenantAction(
  _state: CreateTenantState,
  form: FormData,
): Promise<CreateTenantState> {
  const staff = await requireStaff('createTenant');
  let id: string;
  try {
    const org = await provisionTenant(staff, Object.fromEntries(form));
    id = org.id;
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === 'not_found') return { error: 'owner', fields: ['ownerEmail'] };
      if (error.code === 'conflict') return { error: 'slug', fields: ['slug'] };
    }
    if (error instanceof z.ZodError)
      return { error: 'invalid', fields: [...new Set(error.issues.map((issue) => String(issue.path[0])))] };
    return { error: 'failed' };
  }
  revalidatePath('/');
  revalidatePath('/tenants');
  redirect(`/tenants/${id}`);
}
