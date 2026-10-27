import { accessTarget, pageTarget, publicEventBySlug } from '@yayatoh/events';
import { publicProgramDocuments, publicProgramMedia } from '@yayatoh/media';
import { publicSponsor } from '@yayatoh/program';
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
 * A sponsor's public page: logo, tier, longer description, contact, video, brochures and its team
 * at the event. Only sponsors the website shows (their package places the logo on the website) in
 * the tiers that get a page. On a tenant site `orgId` is the host's org.
 */
export async function PublicSponsorView({
  slug,
  sponsorId,
  orgId = null,
}: {
  slug: string;
  sponsorId: string;
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
  const sponsor = await publicSponsor(target, sponsorId);
  if (!sponsor) notFound();
  const images = await publicProgramMedia(target.orgId, target.eventId, { privateOk });
  const logo = images.get(sponsor.id);
  const docs = await publicProgramDocuments(target.orgId, 'sponsor', sponsor.id, { privateOk });
  const t = await getTranslations('publicEvent');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 bg-surface px-6 py-10">
      <nav aria-label={t('breadcrumb')}>
        <Link
          href={`/events/${slug}#sponsors`}
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
        <p className="m-0 text-label font-bold uppercase tracking-wide text-primary-ink">
          {t('sponsorTier', { tier: sponsor.tierName })}
        </p>
        <h1 className="m-0 text-[36px] leading-tight font-extrabold tracking-[-0.03em]">{sponsor.name}</h1>
        {sponsor.description ? <Markdown source={sponsor.description} /> : null}
      </header>
      {sponsor.longDescription ? <Markdown source={sponsor.longDescription} /> : null}
      {sponsor.videoUrl ? (
        <section aria-labelledby="sponsor-video" className="flex flex-col gap-2">
          <h2 id="sponsor-video" className="text-section">
            {t('video')}
          </h2>
          <VideoEmbed url={sponsor.videoUrl} title={t('videoTitle', { name: sponsor.name })} />
        </section>
      ) : null}
      {sponsor.contactEmail || sponsor.contactPhone || sponsor.websiteUrl ? (
        <section aria-labelledby="sponsor-contact" className="flex flex-col gap-2">
          <h2 id="sponsor-contact" className="text-section">
            {t('contact')}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-body">
            {sponsor.contactEmail ? (
              <li className="flex items-center gap-2">
                <Mail aria-hidden="true" className="size-4 text-primary-ink" />
                <a href={`mailto:${sponsor.contactEmail}`} className="underline underline-offset-2">
                  {sponsor.contactEmail}
                </a>
              </li>
            ) : null}
            {sponsor.contactPhone ? (
              <li className="flex items-center gap-2">
                <Phone aria-hidden="true" className="size-4 text-primary-ink" />
                <a
                  href={`tel:${sponsor.contactPhone.replace(/[^+\d]/g, '')}`}
                  className="underline underline-offset-2"
                >
                  {sponsor.contactPhone}
                </a>
              </li>
            ) : null}
            {sponsor.websiteUrl ? (
              <li>
                <a
                  href={sponsor.websiteUrl}
                  rel="noopener noreferrer nofollow"
                  className="break-all underline underline-offset-2"
                >
                  {t('website', { name: sponsor.name })}
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
      <ProgramDocumentLinks docs={docs} heading={t('brochures')} />
      {sponsor.team.length > 0 ? (
        <section aria-labelledby="sponsor-team" className="flex flex-col gap-2">
          <h2 id="sponsor-team" className="text-section">
            {t('teamAtEvent')}
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
            {sponsor.team.map((m) => (
              <li
                key={`${m.name}-${m.title ?? ''}`}
                className="flex flex-col rounded-card border border-line p-4"
              >
                <span className="font-medium">{m.name}</span>
                {m.title ? <span className="text-caption text-ink-2">{m.title}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
