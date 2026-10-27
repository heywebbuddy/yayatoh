import { accessTarget, pageTarget, publicEventBySlug } from '@yayatoh/events';
import { publicProgramDocuments, publicProgramMedia } from '@yayatoh/media';
import { publicExhibitor } from '@yayatoh/program';
import { Mail, Phone } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { ProgramDocumentLinks } from '@/components/program-document-links.tsx';
import { VideoEmbed } from '@/components/video-embed.tsx';
import { Link } from '@/i18n/navigation.ts';
import { currentAccess } from '@/server/visitor.ts';

/**
 * A listed exhibitor's public page: logo, description, booth, categories, links, contact, video
 * and brochures. Unlisted exhibitors are a 404. On a tenant site `orgId` is the host's org.
 */
export async function PublicExhibitorView({
  slug,
  exhibitorId,
  orgId = null,
}: {
  slug: string;
  exhibitorId: string;
  orgId?: string | null;
}) {
  let target = await pageTarget(slug);
  let pub = await publicEventBySlug(slug);
  let privateOk = false;
  if (!target || !pub) {
    const live = await accessTarget(slug);
    const grant = live ? await currentAccess(live.orgId, live.eventId) : null;
    if (live?.visibility !== 'private' || !grant?.unlocksEvent) notFound();
    target = live;
    privateOk = true;
    pub = await publicEventBySlug(slug, { includePrivate: true });
  }
  if (!pub || (orgId && target.orgId !== orgId)) notFound();
  const x = await publicExhibitor(target, exhibitorId);
  if (!x) notFound();
  const images = await publicProgramMedia(target.orgId, target.eventId, { privateOk });
  const logo = images.get(x.id);
  const docs = await publicProgramDocuments(target.orgId, 'exhibitor', x.id, { privateOk });
  const t = await getTranslations('publicEvent');
  const booth = x.boothNumbers.length ? x.boothNumbers.join(', ') : x.boothLabel;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 bg-surface px-6 py-10">
      <nav aria-label={t('breadcrumb')}>
        <Link
          href={`/events/${slug}#exhibitors`}
          className="inline-flex min-h-6 items-center text-caption underline underline-offset-2"
        >
          {t('backToEvent', { name: pub.name })}
        </Link>
      </nav>
      <header className="flex flex-col gap-3">
        {logo ? (
          <MediaPicture
            image={logo}
            sizes="320px"
            eager
            className="h-24 w-auto max-w-80 self-start object-contain"
          />
        ) : null}
        <h1 className="m-0 text-[36px] leading-tight font-extrabold tracking-[-0.03em]">{x.name}</h1>
        {booth ? <p className="m-0 text-body text-ink-2">{t('booth', { booth })}</p> : null}
        {x.categories.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {x.categories.map((c) => (
              <li key={c} className="rounded-tag bg-surface-3 px-2 py-0.5 text-caption text-ink-2">
                {c}
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      {x.description ? <Markdown source={x.description} /> : null}
      {x.videoUrl ? (
        <section aria-labelledby="exhibitor-video" className="flex flex-col gap-2">
          <h2 id="exhibitor-video" className="text-section">
            {t('video')}
          </h2>
          <VideoEmbed url={x.videoUrl} title={t('videoTitle', { name: x.name })} />
        </section>
      ) : null}
      {x.contactEmail || x.contactPhone || x.websiteUrl || x.links.length > 0 ? (
        <section aria-labelledby="exhibitor-contact" className="flex flex-col gap-2">
          <h2 id="exhibitor-contact" className="text-section">
            {t('contact')}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-body">
            {x.contactEmail ? (
              <li className="flex items-center gap-2">
                <Mail aria-hidden="true" className="size-4 text-primary-ink" />
                <a href={`mailto:${x.contactEmail}`} className="underline underline-offset-2">
                  {x.contactEmail}
                </a>
              </li>
            ) : null}
            {x.contactPhone ? (
              <li className="flex items-center gap-2">
                <Phone aria-hidden="true" className="size-4 text-primary-ink" />
                <a
                  href={`tel:${x.contactPhone.replace(/[^+\d]/g, '')}`}
                  className="underline underline-offset-2"
                >
                  {x.contactPhone}
                </a>
              </li>
            ) : null}
            {x.websiteUrl ? (
              <li>
                <a
                  href={x.websiteUrl}
                  rel="noopener noreferrer nofollow"
                  className="break-all underline underline-offset-2"
                >
                  {t('website', { name: x.name })}
                </a>
              </li>
            ) : null}
            {x.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ProgramDocumentLinks docs={docs} heading={t('brochures')} />
    </main>
  );
}
