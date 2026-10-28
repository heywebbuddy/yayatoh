import { Button, Card, PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { getHero } from '@/server/platform-content.ts';
import { requireStaff } from '@/server/staff.ts';
import { saveHeroAction } from '../actions.ts';
import { ContentTabs } from '../tabs.tsx';

/** The home hero: headline, subtitle, image, optional video and the call to action. */
export default async function HeroAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const hero = await getHero(staff.actor);
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <ContentTabs active="hero" done={sp.done} error={sp.error} />
      <Card size="panel">
        <p className="mb-4 text-body text-ink-2">{t('hero.explain')}</p>
        <form action={saveHeroAction} encType="multipart/form-data" className="flex flex-col gap-4">
          {hero?.imageAssetId ? <input type="hidden" name="imageAssetId" value={hero.imageAssetId} /> : null}
          {hero?.videoAssetId ? <input type="hidden" name="videoAssetId" value={hero.videoAssetId} /> : null}
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('hero.headline')}
            <input
              name="headline"
              maxLength={120}
              defaultValue={hero?.headline ?? ''}
              className="field w-full"
            />
          </label>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('hero.subtitle')}
            <textarea
              name="subtitle"
              rows={2}
              maxLength={300}
              defaultValue={hero?.subtitle ?? ''}
              className="field w-full"
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-body font-semibold">{t('hero.image')}</span>
            {hero?.imageAssetId ? (
              <div className="flex flex-wrap items-center gap-3">
                <img
                  src={`/api/asset/${hero.imageAssetId}`}
                  alt=""
                  className="h-24 w-auto rounded-control border border-line"
                />
                <label className="flex items-center gap-2 text-body font-normal">
                  <input type="checkbox" name="remove_image" value="1" className="size-5 accent-primary" />
                  {t('hero.removeImage')}
                </label>
              </div>
            ) : null}
            <input
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={t('hero.image')}
            />
            <span className="text-caption text-ink-2">{t('hero.imageHint')}</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-body font-semibold">{t('hero.video')}</span>
            {hero?.videoAssetId ? (
              <div className="flex flex-wrap items-center gap-3">
                {/* biome-ignore lint/a11y/useMediaCaption: a muted silent preview in the console */}
                <video
                  src={`/api/asset/${hero.videoAssetId}`}
                  muted
                  controls
                  className="h-24 w-auto rounded-control"
                />
                <label className="flex items-center gap-2 text-body font-normal">
                  <input type="checkbox" name="remove_video" value="1" className="size-5 accent-primary" />
                  {t('hero.removeVideo')}
                </label>
              </div>
            ) : null}
            <input name="video" type="file" accept="video/mp4,video/webm" aria-label={t('hero.video')} />
            <span className="text-caption text-ink-2">{t('hero.videoHint')}</span>
          </div>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('hero.videoUrl')}
            <input
              name="videoUrl"
              type="url"
              maxLength={500}
              defaultValue={hero?.videoUrl ?? ''}
              className="field w-full"
            />
            <span className="text-caption font-normal text-ink-2">{t('hero.videoUrlHint')}</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('hero.ctaLabel')}
              <input
                name="ctaLabel"
                maxLength={60}
                defaultValue={hero?.ctaLabel ?? ''}
                className="field w-full"
              />
            </label>
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('hero.ctaHref')}
              <input
                name="ctaHref"
                maxLength={300}
                defaultValue={hero?.ctaHref ?? ''}
                className="field w-full"
              />
              <span className="text-caption font-normal text-ink-2">{t('hero.ctaHint')}</span>
            </label>
          </div>
          <Button type="submit" className="self-start">
            {t('hero.save')}
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
