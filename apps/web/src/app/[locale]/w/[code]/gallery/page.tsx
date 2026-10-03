import { type GalleryItemDto, publicGalleryQuery } from '@yayatoh/gallery';
import { guestSiteTarget } from '@yayatoh/guests';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { Alert, Card, CardHeader, EmptyState, Label, PageHeader, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GalleryPhoto } from '@/components/gallery/photo.tsx';
import { GalleryUploader } from '@/components/gallery/uploader.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { siteAccess } from '../access.ts';
import { unlockSiteThenAction } from '../actions.ts';
import { SiteGateForm } from '../gate-form.tsx';
import {
  addGuestVideoAction,
  completeGuestUploadAction,
  removeOwnItemAction,
  requestGuestUploadAction,
} from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('gallery.guest');
  // Guests' photos are personal data (P4-3): never indexed, never followed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const MB = 1024 * 1024;
const backLink =
  'inline-flex min-h-11 items-center gap-1 font-bold text-primary-ink underline underline-offset-2';

/**
 * The guest gallery (M4.5b): `/w/{code}/gallery`, behind the guest website's password. Guests
 * share photos from their phones (HEIC too) straight to storage, add YouTube or Vimeo links, see
 * what the hosts published and their own photos with their state, and take back their own.
 * Phone first: 44 px targets, one primary action. Locked: the event's name and the gate only.
 */
export default async function GuestGalleryPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code: raw } = await params;
  setRequestLocale(locale);
  const code = decodeURIComponent(raw).toUpperCase();
  const target = await guestSiteTarget(code);
  if (!target) notFound();
  const uploader = (await cookies()).get(`yy_gal_${code}`)?.value ?? null;
  const view = await executeQuery(
    publicGalleryQuery,
    { eventId: target.eventId, access: await siteAccess(code), uploader },
    createCtx({ orgId: target.orgId, locale }),
    ports,
  ).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  });
  if (!view) notFound();
  const t = await getTranslations('gallery.guest');
  const tu = await getTranslations('gallery.uploader');
  const shell = (children: React.ReactNode) => (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-14"
    >
      {children}
      <p className="m-0 border-t border-line pt-6">
        <Link href={`/w/${code}`} className={backLink}>
          {t('backToSite')}
        </Link>
      </p>
    </main>
  );

  if (view.state === 'locked')
    return shell(
      <>
        <PageHeader
          eyebrow={<Label>{view.eventName}</Label>}
          title={t('title')}
          description={t('gateIntro')}
        />
        <SiteGateForm
          action={unlockSiteThenAction.bind(null, code, 'gallery')}
          challenge={humanCheckWidget()}
        />
      </>,
    );
  if (view.state === 'closed')
    return shell(
      <>
        <PageHeader eyebrow={<Label>{view.eventName}</Label>} title={t('title')} />
        <EmptyState title={t('closedTitle')} description={t('closedDescription')} />
      </>,
    );

  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const errors = {
    url: t('errors.videoLink'),
    video_link: t('errors.videoLink'),
    name: tu('nameRequired'),
    required: tu('nameRequired'),
    guest_items: tu('errors.guest_items'),
    event_items: tu('errors.event_items'),
    gallery_closed: tu('errors.gallery_closed'),
    locked: tu('errors.locked'),
  };
  const label = (i: GalleryItemDto) =>
    i.caption ?? (i.by ? t('photoBy', { name: i.by }) : i.byHost ? t('photoByHosts') : t('photo'));
  const media = (i: GalleryItemDto) =>
    i.kind === 'photo' ? (
      <GalleryPhoto
        photo={i}
        alt={label(i)}
        sizes="(min-width: 640px) 33vw, 50vw"
        className="block aspect-square w-full rounded-control bg-surface-3 object-cover"
      />
    ) : i.video ? (
      <a
        href={i.video.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex aspect-square min-h-11 items-center justify-center rounded-control bg-surface-3 px-3 text-center text-body font-bold text-primary-ink underline underline-offset-2"
      >
        {t(`watchOn.${i.video.provider}`)}
      </a>
    ) : null;
  const quotaLeft = view.quota.quotaItems - view.quota.items;

  return shell(
    <>
      <PageHeader
        eyebrow={<Label>{view.eventName}</Label>}
        title={t('title')}
        description={view.moderation === 'hold' ? t('introHold') : t('introAuto')}
        actions={
          <Link
            href={`/w/${code}/slideshow`}
            className="inline-flex min-h-11 items-center rounded-pill border border-line bg-surface px-4 text-body font-bold text-ink"
          >
            {t('openSlideshow')}
          </Link>
        }
      />

      <section aria-labelledby="share-heading">
        <Card size="panel" className="flex flex-col gap-4">
          <CardHeader id="share-heading" title={t('shareTitle')} />
          <p className="m-0 text-caption text-ink-2" data-testid="guest-quota">
            {t('quota', {
              items: view.quota.items,
              quotaItems: view.quota.quotaItems,
              used: num.format(view.quota.usedBytes / MB),
              quota: num.format(view.quota.quotaBytes / MB),
            })}
          </p>
          <GalleryUploader
            request={requestGuestUploadAction.bind(null, code)}
            complete={completeGuestUploadAction.bind(null, code)}
            maxBytes={view.maxUploadBytes}
            askName
            defaultName={view.myName}
            idPrefix="guest-upload"
            notice={
              view.eventFull ? (
                <Alert tone="warning" title={t('fullTitle')}>
                  {t('fullBody')}
                </Alert>
              ) : quotaLeft <= 0 ? (
                <Alert tone="info" title={t('quotaReachedTitle')}>
                  {t('quotaReachedBody')}
                </Alert>
              ) : null
            }
          />
          <p className="m-0 text-caption text-ink-2">{t('privacyNote')}</p>
        </Card>
      </section>

      {!view.eventFull && quotaLeft > 0 ? (
        <section aria-labelledby="video-heading">
          <Card size="panel" className="flex flex-col gap-4">
            <CardHeader as="h2" id="video-heading" title={t('videoTitle')} />
            <p className="m-0 text-body text-ink-2">{t('videoIntro')}</p>
            <ProgramForm
              action={addGuestVideoAction.bind(null, code)}
              fields={[
                ...(view.myName
                  ? []
                  : [
                      {
                        kind: 'text' as const,
                        name: 'name',
                        label: tu('name'),
                        hint: tu('nameHint'),
                        maxLength: 60,
                        required: true,
                      },
                    ]),
                {
                  kind: 'url',
                  name: 'url',
                  label: t('videoUrl'),
                  hint: t('videoUrlHint'),
                  maxLength: 500,
                  required: true,
                },
                { kind: 'text', name: 'caption', label: tu('caption'), maxLength: 280 },
              ]}
              idPrefix="guest-video"
              submitLabel={t('addVideo')}
              successLabel={view.moderation === 'hold' ? t('videoHeld') : t('videoAdded')}
              errors={errors}
              reset
            />
          </Card>
        </section>
      ) : null}

      {view.mine.length ? (
        <section aria-labelledby="mine-heading" className="flex flex-col gap-4">
          <h2 id="mine-heading" className="m-0 text-section text-ink">
            {t('mineTitle', { count: view.mine.length })}
          </h2>
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
            {view.mine.map((i) => (
              <li key={i.id} className="flex flex-col gap-2" data-item-id={i.id}>
                {media(i)}
                <StatusPill
                  tone={i.status === 'published' ? 'success' : 'waiting'}
                  label={i.status === 'published' ? t('statePublished') : t('statePending')}
                />
                <ProgramForm
                  action={removeOwnItemAction.bind(null, code, i.id)}
                  fields={[]}
                  idPrefix={`take-back-${i.id}`}
                  submitLabel={t('takeBack', { name: label(i) })}
                  successLabel={t('takenBack')}
                  errors={errors}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="published-heading" className="flex flex-col gap-4">
        <h2 id="published-heading" className="m-0 text-section text-ink">
          {t('publishedTitle')}
        </h2>
        {view.published.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
            {view.published.map((i) => (
              <li key={i.id} className="flex flex-col gap-1" data-item-id={i.id}>
                {media(i)}
                <p className="m-0 text-caption text-ink-2" dir="auto">
                  {label(i)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>,
  );
}
