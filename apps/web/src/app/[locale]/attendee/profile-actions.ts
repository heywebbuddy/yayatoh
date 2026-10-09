'use server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import sharp from 'sharp';
import { z } from 'zod';
import type { FormState } from '../../../lib/form-state.ts';
import { getAuth } from '../../../server/auth.ts';
import { dashboardAccess } from '../../../server/dashboard-access.ts';
import { ownAuthSession } from '../../../server/session.ts';

export async function saveAttendeeProfile(_previous: FormState, form: FormData): Promise<FormState> {
  const session = await ownAuthSession();
  if (!session?.user.emailVerified) return { ok: false, code: 'unauthenticated' };
  if ((await dashboardAccess()).kind === 'organizer') return { ok: false, code: 'forbidden' };
  const name = z.string().trim().min(1).max(120).safeParse(form.get('name'));
  if (!name.success) return { ok: false, code: 'validation_failed', fields: ['name'] };
  const photo = form.get('photo');
  let image: string | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 512 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type))
      return { ok: false, code: 'validation_failed', fields: ['photo'] };
    try {
      const input = Buffer.from(await photo.arrayBuffer());
      const metadata = await sharp(input, { limitInputPixels: 16_000_000 }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new Error('Unsupported image');
      const thumbnail = await sharp(input, { limitInputPixels: 16_000_000 })
        .rotate()
        .resize(256, 256, { fit: 'cover' })
        .webp({ quality: 75 })
        .toBuffer();
      image = `data:image/webp;base64,${thumbnail.toString('base64')}`;
    } catch {
      return { ok: false, code: 'validation_failed', fields: ['photo'] };
    }
  } else if (form.get('removePhoto') === '1') {
    image = '';
  }
  try {
    await getAuth().api.updateUser({
      headers: await headers(),
      body: { name: name.data, ...(image !== undefined ? { image } : {}) },
    });
  } catch {
    return { ok: false, code: 'internal_error' };
  }
  revalidatePath('/attendee', 'layout');
  return { ok: true, code: null };
}
