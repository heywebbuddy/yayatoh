import { type GalleryItemDto, hostGalleryQuery } from '@yayatoh/gallery';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import {
  Alert,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressBar,
  StatusPill,
} from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GalleryPhoto } from '@/components/gallery/photo.tsx';
import { GalleryUploader } from '@/components/gallery/uploader.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { CopyLink } from '../guests/rsvp/copy-link.tsx';
import { appOrigin } from '../guests/rsvp/links.ts';
import {
  addVideoAction,
  completeUploadAction,
  moderateAction,
  removeItemAction,
  requestUploadAction,
  saveSettingsAction,
} from './actions.ts';

const MB = 1024 * 1024;

/**
 * The event gallery (M4.5b): the hosts turn it on, choose whether guests' photos wait for them
 * (P4-6), see the storage used against the event's cap, upload their own photos (published at
 * once), add YouTube or Vimeo links (P4-5), work the moderation queue and open the live
 * slideshow. Guests reach the gallery through the guest website. Hosts, co-hosts and planners
 * with `guests:write` change it; viewers read.
 */
export default async function GalleryPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'gallery');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'gallery');
  if (!nav || !navIncludes(profile, data.modules, 'gallery') || !can('guests:read')) notFound();
  const t = await getTranslations('gallery.host');
  const tr = await getTranslations();
  const canWrite = can('guests:write');
  const g = await executeQuery(hostGalleryQuery, { eventId: ev.id }, data.ctx, ports);
  const s = g.settings;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const size = (bytes: number) =>
    bytes >= 1024 * MB
      ? t('gb', { n: num.format(bytes / 1024 / MB) })
      : t('mb', { n: num.format(bytes / MB) });
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: ev.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  const guestUrl = g.siteCode ? `${appOrigin()}/w/${g.siteCode}/gallery` : null;
  const full = g.usage.usedBytes >= g.usage.capBytes;
  const errors = {
    capMb: t('errors.number'),
    guestQuotaMb: t('errors.number'),
    guestQuotaItems: t('errors.number'),
    url: t('errors.videoLink'),
    video_link: t('errors.videoLink'),
    caption: t('errors.caption'),
    event_items: t('errors.eventItems'),
    event_cap: t('errors.eventCap'),
  };

  const label = (i: GalleryItemDto) =>
    i.caption ?? (i.by ? t('photoBy', { name: i.by }) : i.byHost ? t('photoByHosts') : t('photo'));

  const itemCard = (i: GalleryItemDto, actions: React.ReactNode) => (
    <li key={i.id} data-item-id={i.id}>
      <Card size="panel" className="flex h-full flex-col gap-3">
        {i.kind === 'photo' ? (
          <GalleryPhoto
            photo={i}
            alt={label(i)}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="block aspect-[4/3] w-full rounded-control bg-surface-3 object-cover"
          />
        ) : i.video ? (
          <a
            href={i.video.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="flex aspect-[4/3] min-h-11 items-center justify-center rounded-control bg-surface-3 px-4 text-center text-body font-bold text-primary-ink underline underline-offset-2"
          >
            {t(`watchOn.${i.video.provider}`)}
          </a>
        ) : null}
        <div className="flex flex-col gap-1">
          <p className="m-0 text-body font-bold text-ink" dir="auto">
            {label(i)}
          </p>
          <p className="m-0 text-caption text-ink-2">
            {[
              i.by ? t('by', { name: i.by }) : i.byHost ? t('byHosts') : null,
              fmt(i.publishedAt ?? i.createdAt),
              i.kind === 'photo' ? size(i.bytes) : t(`provider.${i.video?.provider ?? 'youtube'}`),
              i.sourceType === 'heic' ? 'HEIC' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {actions}
      </Card>
    </li>
  );

  return (
    <>
      <PageHeader
        title={tr(navLabelKey(profile, nav))}
        description={t('subtitle')}
        actions={
          <Link
            href={`/o/${org}/e/${event}/gallery/slideshow`}
            className="inline-flex min-h-11 items-center rounded-pill border border-line bg-surface px-4 text-body font-bold text-ink"
          >
            {t('openSlideshow')}
          </Link>
        }
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      {!g.sitePublished ? (
        <Alert tone="warning" title={t('siteNeededTitle')}>
          <Link
            href={`/o/${org}/e/${event}/website`}
            className="inline-flex min-h-6 items-center font-bold underline underline-offset-2"
          >
            {t('siteNeededLink')}
          </Link>
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section aria-labelledby="gallery-status-heading">
          <Card size="panel" className="flex flex-col gap-4">
            <CardHeader
              id="gallery-status-heading"
              title={t('statusTitle')}
              actions={
                <StatusPill tone={s.enabled ? 'success' : 'neutral'} label={s.enabled ? t('on') : t('off')} />
              }
            />
            <div className="flex flex-col gap-2">
              <p className="m-0 text-body text-ink" data-testid="gallery-usage">
                {t('usage', { used: size(g.usage.usedBytes), cap: size(g.usage.capBytes) })}
              </p>
              <ProgressBar
                value={Math.min(g.usage.usedBytes, g.usage.capBytes)}
                max={g.usage.capBytes}
                label={t('usageLabel')}
                tone={full ? 'danger' : 'primary'}
              />
              <p className="m-0 text-caption text-ink-2">
                {t('counts', { published: g.usage.published, pending: g.usage.pending })}
              </p>
              {full ? (
                <Alert tone="danger" title={t('fullTitle')}>
                  {t('fullBody')}
                </Alert>
              ) : null}
            </div>
            {s.enabled && g.sitePublished && guestUrl ? (
              <CopyLink label={t('guestAddress')} url={guestUrl} />
            ) : null}
            <p className="m-0 text-caption text-ink-2">{t('privacyNote')}</p>
            {canWrite ? (
              <ProgramForm
                action={saveSettingsAction.bind(null, org, event)}
                fields={[
                  {
                    kind: 'select',
                    name: 'enabled',
                    label: t('fields.enabled'),
                    defaultValue: s.enabled ? 'on' : 'off',
                    options: [
                      { value: 'on', label: t('enabledOn') },
                      { value: 'off', label: t('enabledOff') },
                    ],
                  },
                  {
                    kind: 'select',
                    name: 'moderation',
                    label: t('fields.moderation'),
                    hint: t('fields.moderationHint'),
                    defaultValue: s.moderation,
                    options: [
                      { value: 'hold', label: t('moderation.hold') },
                      { value: 'auto', label: t('moderation.auto') },
                    ],
                  },
                  {
                    kind: 'number',
                    name: 'capMb',
                    label: t('fields.cap'),
                    hint: t('fields.capHint', { max: num.format(s.maxCapBytes / MB) }),
                    defaultValue: String(Math.floor(s.capBytes / MB) || 1),
                  },
                  {
                    kind: 'number',
                    name: 'guestQuotaMb',
                    label: t('fields.guestBytes'),
                    hint: t('fields.guestBytesHint', { max: num.format(s.maxGuestQuotaBytes / MB) }),
                    defaultValue: String(Math.floor(s.guestQuotaBytes / MB) || 1),
                  },
                  {
                    kind: 'number',
                    name: 'guestQuotaItems',
                    label: t('fields.guestItems'),
                    hint: t('fields.guestItemsHint', { max: s.maxGuestQuotaItems }),
                    defaultValue: String(s.guestQuotaItems),
                  },
                ]}
                idPrefix="gallery-settings"
                submitLabel={t('saveSettings')}
                successLabel={t('settingsSaved')}
                errors={errors}
              />
            ) : (
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
                <dt className="font-bold text-ink-2">{t('fields.moderation')}</dt>
                <dd className="m-0">{t(`moderation.${s.moderation}`)}</dd>
                <dt className="font-bold text-ink-2">{t('fields.cap')}</dt>
                <dd className="m-0">{size(s.capBytes)}</dd>
              </dl>
            )}
          </Card>
        </section>

        {canWrite ? (
          <section aria-labelledby="gallery-upload-heading" className="flex flex-col gap-5">
            <Card size="panel" className="flex flex-col gap-4">
              <CardHeader id="gallery-upload-heading" title={t('uploadTitle')} />
              <p className="m-0 text-body text-ink-2">{t('uploadIntro')}</p>
              <GalleryUploader
                request={requestUploadAction.bind(null, org, event)}
                complete={completeUploadAction.bind(null, org, event)}
                maxBytes={s.maxUploadBytes}
                askName={false}
                idPrefix="gallery-host-upload"
              />
            </Card>
            <Card size="panel" className="flex flex-col gap-4">
              <CardHeader as="h3" id="gallery-video-heading" title={t('videoTitle')} />
              <p className="m-0 text-body text-ink-2">
                {g.videoUploads ? t('videoIntroStream') : t('videoIntro')}
              </p>
              <ProgramForm
                action={addVideoAction.bind(null, org, event)}
                fields={[
                  {
                    kind: 'url',
                    name: 'url',
                    label: t('fields.videoUrl'),
                    hint: t('fields.videoUrlHint'),
                    maxLength: 500,
                    required: true,
                  },
                  { kind: 'text', name: 'caption', label: t('fields.caption'), maxLength: 280 },
                ]}
                idPrefix="gallery-video"
                submitLabel={t('addVideo')}
                successLabel={t('videoAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </div>

      <section aria-labelledby="gallery-pending-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="gallery-pending-heading" className="m-0 text-section text-ink">
            {t('pendingTitle', { count: g.usage.pending })}
          </h2>
          {canWrite && g.pending.length > 1 ? (
            <ProgramForm
              action={moderateAction.bind(
                null,
                org,
                event,
                g.pending.map((i) => i.id),
                'approve',
              )}
              fields={[]}
              idPrefix="gallery-approve-all"
              submitLabel={t('approveAll', { count: g.pending.length })}
              successLabel={t('approved')}
              errors={errors}
            />
          ) : null}
        </div>
        {g.pending.length === 0 ? (
          <EmptyState
            title={t('pendingEmptyTitle')}
            description={s.moderation === 'auto' ? t('pendingEmptyAuto') : t('pendingEmptyHold')}
            action={
              canWrite ? (
                <a href="#gallery-upload-heading" className={buttonClass('secondary', 'md')}>
                  {t('uploadTitle')}
                </a>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('secondary', 'md')}>
                  {tr('emptyActions.eventHome')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {g.pending.map((i) =>
              itemCard(
                i,
                canWrite ? (
                  <div className="mt-auto flex flex-wrap gap-3 border-t border-line pt-3">
                    <ProgramForm
                      action={moderateAction.bind(null, org, event, [i.id], 'approve')}
                      fields={[]}
                      idPrefix={`approve-${i.id}`}
                      submitLabel={t('approve', { name: label(i) })}
                      successLabel={t('approved')}
                      errors={errors}
                    />
                    <ProgramForm
                      action={moderateAction.bind(null, org, event, [i.id], 'reject')}
                      fields={[]}
                      idPrefix={`reject-${i.id}`}
                      submitLabel={t('reject', { name: label(i) })}
                      successLabel={t('rejected')}
                      errors={errors}
                    />
                  </div>
                ) : null,
              ),
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="gallery-published-heading" className="flex flex-col gap-4">
        <h2 id="gallery-published-heading" className="m-0 text-section text-ink">
          {t('publishedTitle', { count: g.usage.published })}
        </h2>
        {g.published.length === 0 ? (
          <EmptyState
            title={t('publishedEmptyTitle')}
            description={canWrite ? t('publishedEmptyWrite') : t('publishedEmptyRead')}
            action={
              canWrite ? (
                <a href="#gallery-upload-heading" className={buttonClass('primary', 'md')}>
                  {t('uploadTitle')}
                </a>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('secondary', 'md')}>
                  {tr('emptyActions.eventHome')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {g.published.map((i) =>
              itemCard(
                i,
                canWrite ? (
                  <div className="mt-auto border-t border-line pt-3">
                    <ProgramForm
                      action={removeItemAction.bind(null, org, event, i.id)}
                      fields={[]}
                      idPrefix={`remove-${i.id}`}
                      submitLabel={t('remove', { name: label(i) })}
                      successLabel={t('removed')}
                      errors={errors}
                    />
                  </div>
                ) : null,
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}
