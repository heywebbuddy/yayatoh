import { accessTarget, pageTarget, publicEventBySlug } from '@yayatoh/events';
import { publicProgramMedia } from '@yayatoh/media';
import { publicSpeaker } from '@yayatoh/program';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { SessionRow } from '@/components/program-sections.tsx';
import { Link } from '@/i18n/navigation.ts';
import { currentAccess } from '@/server/visitor.ts';

/**
 * A speaker's public page (M1.4f): profile, links and their sessions, for events with a public
 * page (or a private one an access code opened, as the event page). On a tenant site `orgId` is
 * the host's org: another org's event is a 404 there.
 */
export async function PublicSpeakerView({
  locale,
  slug,
  speakerId,
  orgId = null,
}: {
  locale: string;
  slug: string;
  speakerId: string;
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
  const page = await publicSpeaker(target, speakerId);
  if (!page) notFound();
  // M1.4h: speaker photos (this speaker's, and co-speakers' avatars in the session list).
  const images = Object.fromEntries(await publicProgramMedia(target.orgId, target.eventId, { privateOk }));
  const t = await getTranslations('publicEvent');
  const ta = await getTranslations('agenda');
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: pub.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: pub.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const { speaker } = page;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 bg-white px-6 py-10">
      <nav aria-label={t('breadcrumb')}>
        <Link
          href={`/events/${slug}#speakers`}
          className="inline-flex min-h-6 items-center text-caption underline underline-offset-2"
        >
          {t('backToEvent', { name: pub.name })}
        </Link>
      </nav>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {images[speaker.id] ? (
          <MediaPicture
            image={images[speaker.id] as NonNullable<(typeof images)[string]>}
            sizes="160px"
            eager
            className="size-40 shrink-0 rounded-card object-cover"
          />
        ) : null}
        <div className="flex flex-col gap-1">
          <h1 className="text-[36px] leading-tight font-normal tracking-[-0.03em]">{speaker.name}</h1>
          {speaker.title || speaker.company ? (
            <p className="text-body text-zinc-600">
              {[speaker.title, speaker.company].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
      </header>
      {speaker.bio ? <Markdown source={speaker.bio} /> : null}
      {speaker.links.length > 0 ? (
        <section aria-labelledby="speaker-links" className="flex flex-col gap-2">
          <h2 id="speaker-links" className="text-section">
            {t('speakerLinks')}
          </h2>
          <ul className="flex list-none flex-wrap gap-3 p-0">
            {speaker.links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  rel="noopener noreferrer nofollow"
                  className="inline-flex min-h-6 items-center underline underline-offset-2"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="speaker-sessions" className="flex flex-col gap-2">
        <h2 id="speaker-sessions" className="text-section">
          {t('speakerSessions')}
        </h2>
        {page.sessions.length === 0 ? (
          <p className="text-body text-zinc-500">{t('speakerNoSessions')}</p>
        ) : (
          <ol className="list-none divide-y divide-zinc-100 rounded-card border border-zinc-200 p-0">
            {page.sessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                slug={slug}
                time={time}
                day={day.format(s.startsAt)}
                images={images}
                optionalLabel={ta('optional')}
              />
            ))}
          </ol>
        )}
        <p className="text-caption text-zinc-500">
          {t('datesTimezone', { timezone: pub.timezone.replace(/_/g, ' ') })}
        </p>
      </section>
    </main>
  );
}
