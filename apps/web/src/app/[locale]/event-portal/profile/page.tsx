import { formatLinksText } from '@yayatoh/events';
import { PORTAL_PHOTO_MAX_BYTES } from '@yayatoh/media';
import { Avatar, Card } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { proposeProfileAction } from '@/app/[locale]/event-portal/actions.ts';
import { Markdown } from '@/components/markdown.tsx';
import { PortalChangeStatus } from '@/components/portal-change-status.tsx';
import { PortalFileUpload } from '@/components/portal-forms.tsx';
import { PortalShell, PortalSignedOut } from '@/components/portal-shell.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { initialsOf } from '@/lib/initials.ts';
import { loadSpeakerPortal } from '@/server/portal.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'speakerPortal' });
  return { title: t('nav.profile'), robots: { index: false, follow: false } };
}

/**
 * The speaker's profile (M5.3a): the approved version as the agenda shows it, and a form whose
 * changes (and a new photo) go to the organizer for approval.
 */
export default async function SpeakerProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const portal = await loadSpeakerPortal();
  if (!portal) return <PortalSignedOut />;
  const { data } = portal;
  const t = await getTranslations('speakerPortal');
  const tp = await getTranslations('program');
  const s = data.speaker;
  const errors = {
    name: tp('errors.name'),
    links: tp('errors.links'),
    links_line: tp('errors.links'),
    links_url: tp('errors.links'),
    no_change: t('noChange'),
  };
  const photoErrors = {
    no_file: t('errors.noFile'),
    too_large: t('errors.photoTooLarge'),
    unsupported_type: t('errors.photoType'),
    undecodable: t('errors.photoType'),
    too_many_pixels: t('errors.photoTooLarge'),
  };
  return (
    <PortalShell data={data} active="profile" title={t('nav.profile')}>
      {data.profileChange ? <PortalChangeStatus change={data.profileChange} /> : null}
      <section aria-labelledby="current-heading">
        <Card className="flex flex-col gap-2">
          <h2 id="current-heading" className="m-0 text-label text-ink-2 uppercase">
            {t('currentProfile')}
          </h2>
          <div className="flex items-center gap-3">
            <Avatar initials={initialsOf(s.name)} label={s.name} size={48} decorative />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="m-0 text-card text-ink">{s.name}</p>
              {s.title || s.company ? (
                <p className="m-0 text-body text-ink-2">{[s.title, s.company].filter(Boolean).join(' · ')}</p>
              ) : null}
            </div>
          </div>
          {s.bio ? <Markdown source={s.bio} /> : null}
          {s.links.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body">
              {s.links.map((l) => (
                <li key={l.url}>
                  <span className="font-bold text-ink">{l.label}:</span>{' '}
                  <span className="text-primary-ink">{l.url}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </section>
      <section aria-labelledby="edit-heading">
        <Card size="panel" className="flex flex-col gap-3">
          <h2 id="edit-heading" className="m-0 text-card text-ink">
            {t('suggestChanges')}
          </h2>
          <p className="text-caption text-ink-2">{t('approvalHint')}</p>
          <ProgramForm
            action={proposeProfileAction}
            idPrefix="portal-profile"
            submitLabel={t('sendForApproval')}
            successLabel={t('sentForApproval')}
            errors={errors}
            fields={[
              {
                kind: 'text',
                name: 'name',
                label: tp('speakerName'),
                required: true,
                maxLength: 120,
                defaultValue: s.name,
              },
              {
                kind: 'text',
                name: 'title',
                label: tp('jobTitle'),
                maxLength: 120,
                defaultValue: s.title ?? undefined,
              },
              {
                kind: 'text',
                name: 'company',
                label: tp('company'),
                maxLength: 120,
                defaultValue: s.company ?? undefined,
              },
              {
                kind: 'textarea',
                name: 'bio',
                label: tp('bio'),
                hint: tp('markdownHint'),
                rows: 6,
                defaultValue: s.bio,
              },
              {
                kind: 'textarea',
                name: 'links',
                label: tp('links'),
                hint: tp('linksHint'),
                rows: 3,
                defaultValue: s.links.length ? formatLinksText({ items: s.links }) : undefined,
              },
            ]}
          />
        </Card>
      </section>
      <section aria-labelledby="photo-heading">
        <Card size="panel" className="flex flex-col gap-3">
          <h2 id="photo-heading" className="m-0 text-card text-ink">
            {t('photoHeading')}
          </h2>
          {data.profileChange?.status === 'pending' && data.profileChange.hasPhoto ? (
            <p className="text-caption text-ink-2">{t('photoPending')}</p>
          ) : null}
          <PortalFileUpload
            purpose="speaker_photo"
            label={t('photoLabel')}
            hint={t('photoHint')}
            accept="image/jpeg,image/png,image/webp"
            submitLabel={t('photoUpload')}
            successLabel={t('photoSent')}
            errors={photoErrors}
            maxBytes={PORTAL_PHOTO_MAX_BYTES}
          />
        </Card>
      </section>
    </PortalShell>
  );
}
