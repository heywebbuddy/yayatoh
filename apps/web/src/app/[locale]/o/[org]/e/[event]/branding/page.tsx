import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, light, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BrandColorField } from '@/components/brand-color-field.tsx';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { SettingsForm } from '@/components/settings-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { mediaPanel } from '@/server/media.ts';
import { brandAction } from '../../../(org)/settings/actions.ts';

/** Event branding uses the organizer's shared brand kit, which the public event page already reads. */
export default async function EventBrandingPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'branding');
  const t = await getTranslations();
  const canEdit = roleCan(data.role, 'org:update');
  const logo = await mediaPanel(data, 'org', data.org.id, 'logo');

  return (
    <>
      <PageHeader title={t('branding')} description={`${ev.name} · ${t('settings.brand.description')}`} />
      {canEdit ? (
        <section aria-labelledby="event-brand-color-heading" className="flex flex-col gap-3">
          <h2 id="event-brand-color-heading" className="text-section">
            {t('settings.brand.title')}
          </h2>
          <Card>
            <SettingsForm
              action={brandAction.bind(null, org)}
              submitLabel={t('settings.save')}
              savedLabel={t('settings.saved')}
            >
              <BrandColorField initial={data.org.brandColor} fallback={light.primary.toLowerCase()} />
            </SettingsForm>
          </Card>
        </section>
      ) : (
        <EmptyState
          title={t('settings.noAccessTitle')}
          description={t('settings.noAccessDescription')}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {t('settings.findOwner')}
            </Link>
          }
        />
      )}
      <Card size="panel">
        <MediaUploader org={org} slot="logo" ticket={logo.ticket} items={logo.items} />
      </Card>
    </>
  );
}
