import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { PickerProfile } from '@/components/profile-picker.tsx';
import { PICKER_ORDER, profileSectionKeys } from '@/lib/profile-picker.ts';

/** U8: every profile with the sections it includes for this org's modules, translated. */
export async function pickerProfiles(modules: ReadonlySet<string>): Promise<PickerProfile[]> {
  const t = await getTranslations();
  return PICKER_ORDER.map((key) => ({
    key,
    sections: profileSectionKeys(key, modules).map((k) => t(k as 'nav.home')),
  }));
}
