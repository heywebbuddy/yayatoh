import { accessTarget, pageTarget, publicEventBySlug } from '@yayatoh/events';
import { type PublicMediaDto, publicProgramMedia } from '@yayatoh/media';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BoothMap } from '@/components/booth-map.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedExhibitorMap } from '@/server/exhibitor-map.ts';
import { currentAccess } from '@/server/visitor.ts';

/**
 * The public exhibitor map (M5.4a): the hall's booths drawn from the allowlisted map payload, and
 * the same information as lists (by exhibitor, then by booth) for screen readers and keyboards.
 * Only listed exhibitors; never staff, contacts or allowances. For events with a public page (or
 * a private one an access code opened), like the speaker pages.
 */
export async function PublicExhibitorMapView({ slug }: { slug: string }) {
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
  if (!pub) notFound();
  const map = await cachedExhibitorMap(target);
  if (!map) notFound();
  const images = Object.fromEntries(await publicProgramMedia(target.orgId, target.eventId, { privateOk }));
  const t = await getTranslations('exhibitorMap');
  const nameOf = (id: string) => map.exhibitors.find((x) => x.id === id)?.name ?? '';
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 bg-white px-6 py-10">
      <nav aria-label={t('breadcrumb')}>
        <Link
          href={`/events/${slug}`}
          className="inline-flex min-h-6 items-center text-caption underline underline-offset-2"
        >
          {t('back', { name: pub.name })}
        </Link>
      </nav>
      <h1 className="text-[32px] leading-tight font-light tracking-[-0.03em]">
        {t('title', { name: pub.name })}
      </h1>
      <p className="text-body text-zinc-600">{t('intro')}</p>
      <BoothMap
        booths={map.booths.map((b) => ({ ...b, taken: b.exhibitorIds.length > 0 }))}
        label={t('mapLabel', { count: map.booths.length })}
      />

      <section aria-labelledby="map-exhibitors-heading" className="flex flex-col gap-3">
        <h2 id="map-exhibitors-heading" className="text-section">
          {t('exhibitorsHeading', { count: map.exhibitors.length })}
        </h2>
        <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {map.exhibitors.map((x) => (
            <li key={x.id} className="flex flex-col gap-1 rounded-card border border-zinc-200 p-4">
              {images[x.id] ? (
                <MediaPicture
                  image={images[x.id] as PublicMediaDto}
                  sizes="192px"
                  className="h-12 w-auto max-w-48 self-start object-contain"
                />
              ) : null}
              <h3 className="font-medium">{x.name}</h3>
              <span className="text-caption text-zinc-600">
                {x.boothNumbers.length
                  ? t('booths', { count: x.boothNumbers.length, numbers: x.boothNumbers.join(', ') })
                  : t('noBooth')}
              </span>
              {x.categories.length ? (
                <span className="text-caption text-zinc-600">{x.categories.join(' · ')}</span>
              ) : null}
              {x.description ? (
                <Markdown source={x.description} className="flex flex-col gap-2 text-caption text-zinc-600" />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="map-booths-heading" className="flex flex-col gap-3">
        <h2 id="map-booths-heading" className="text-section">
          {t('boothsHeading')}
        </h2>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1) */}
        <section tabIndex={0} aria-label={t('boothsCaption')} className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <caption className="sr-only">{t('boothsCaption')}</caption>
            <thead>
              <tr className="border-b border-zinc-200">
                <th scope="col" className="py-2 pe-4 text-start font-medium">
                  {t('booth')}
                </th>
                <th scope="col" className="py-2 pe-4 text-start font-medium">
                  {t('exhibitor')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('category')}
                </th>
              </tr>
            </thead>
            <tbody>
              {map.booths.map((b) => (
                <tr key={b.id} className="border-b border-zinc-100">
                  <th scope="row" className="py-2 pe-4 text-start font-normal">
                    {b.number}
                  </th>
                  <td className="py-2 pe-4">
                    {b.exhibitorIds.length ? b.exhibitorIds.map(nameOf).join(', ') : t('available')}
                  </td>
                  <td className="py-2">{b.category ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
