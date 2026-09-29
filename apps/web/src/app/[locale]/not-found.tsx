import { buttonClass, EmptyState } from '@yayatoh/ui';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { FrontDoorBeacon } from '@/components/front-door-beacon.tsx';
import { Link } from '@/i18n/navigation.ts';
import { FRONT_DOOR_ROUTE_HEADER } from '@/lib/front-door/constants.ts';

export default async function NotFound() {
  // On a front-door host (M2.4a) the 404 is counted once it is shown.
  const frontDoor = (await headers()).has(FRONT_DOOR_ROUTE_HEADER);
  const t = await getTranslations('notFound');
  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-24">
      <EmptyState
        title={t('title')}
        description={t('description')}
        action={
          <Link href="/" className={buttonClass('secondary')}>
            {t('home')}
          </Link>
        }
      />
      {frontDoor ? <FrontDoorBeacon /> : null}
    </main>
  );
}
