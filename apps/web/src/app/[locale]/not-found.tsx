import { buttonClass } from '@yayatoh/ui';
import { Compass } from 'lucide-react';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { FrontDoorBeacon } from '@/components/front-door-beacon.tsx';
import { PageHero } from '@/components/showcase/page-hero.tsx';
import { Link } from '@/i18n/navigation.ts';
import { FRONT_DOOR_ROUTE_HEADER } from '@/lib/front-door/constants.ts';

export default async function NotFound() {
  // On a front-door host (M2.4a) the 404 is counted once it is shown.
  const frontDoor = (await headers()).has(FRONT_DOOR_ROUTE_HEADER);
  const t = await getTranslations('notFound');
  const tp = await getTranslations('pages.notFound');
  return (
    <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 md:px-6">
      <PageHero eyebrow="404" title={t('title')} lede={t('description')} icon={Compass}>
        <p
          aria-hidden="true"
          className="m-0 font-display text-[96px] leading-none font-black text-ember animate-glow-text motion-reduce:animate-none md:text-[160px]"
        >
          404
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className={buttonClass('ember', 'lg')}>
            {t('home')}
          </Link>
          <Link href="/events" className={buttonClass('secondary', 'lg')}>
            {tp('events')}
          </Link>
          <Link href="/help" className={buttonClass('secondary', 'lg')}>
            {tp('help')}
          </Link>
        </div>
      </PageHero>
      {frontDoor ? <FrontDoorBeacon /> : null}
    </main>
  );
}
