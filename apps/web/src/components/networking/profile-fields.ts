import type { MyProfileDto } from '@yayatoh/engagement';
import { getTranslations } from 'next-intl/server';
import type { FieldSpec } from '@/components/program-form.tsx';

/** The networking profile form's fields (M5.8a): opt-in adds the consent tick. */
export async function profileFields(
  profile: MyProfileDto | null,
  fallbackName: string,
  opts: { consent: boolean },
): Promise<FieldSpec[]> {
  const t = await getTranslations('networking.profile');
  return [
    {
      kind: 'text',
      name: 'displayName',
      label: t('displayName'),
      hint: t('displayNameHint'),
      required: true,
      maxLength: 80,
      defaultValue: profile?.displayName ?? fallbackName,
    },
    {
      kind: 'text',
      name: 'headline',
      label: t('headline'),
      maxLength: 80,
      defaultValue: profile?.headline ?? '',
    },
    {
      kind: 'text',
      name: 'company',
      label: t('company'),
      maxLength: 80,
      defaultValue: profile?.company ?? '',
    },
    {
      kind: 'textarea',
      name: 'bio',
      label: t('bio'),
      hint: t('bioHint'),
      rows: 3,
      defaultValue: profile?.bio ?? '',
    },
    {
      kind: 'text',
      name: 'interests',
      label: t('interests'),
      hint: t('interestsHint'),
      maxLength: 600,
      defaultValue: profile?.interests.join(', ') ?? '',
    },
    ...(opts.consent
      ? [
          {
            kind: 'checkboxes' as const,
            name: 'consent',
            label: t('consentLegend'),
            options: [{ value: 'yes', label: t('consent') }],
          },
        ]
      : []),
  ];
}

/** Field and reason → message for the profile forms. */
export async function profileErrors(): Promise<Record<string, string>> {
  const t = await getTranslations('networking');
  return {
    displayName: t('profile.displayNameRequired'),
    consent: t('profile.consentRequired'),
    headline: t('profile.tooLong'),
    company: t('profile.tooLong'),
    bio: t('profile.bioTooLong'),
    hidden: t('errors.hidden'),
    not_opted_in: t('errors.not_opted_in'),
  };
}
