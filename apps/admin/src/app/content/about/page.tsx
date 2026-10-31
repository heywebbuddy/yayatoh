import { Button, Card, PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { getSetting } from '@/server/platform-site.ts';
import { requireStaff } from '@/server/staff.ts';
import { saveAboutAction } from '../site-actions.ts';
import { ContentTabs } from '../tabs.tsx';

const field = 'flex flex-col gap-2 text-body font-semibold';

/** Every section of the public About us page. Empty rows and empty sections are left out of the page. */
export default async function AboutAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const a = await getSetting(staff.actor, 'about');
  const pad = <T,>(rows: T[], n: number, empty: T) => [
    ...rows,
    ...Array.from({ length: Math.max(0, n - rows.length) }, () => empty),
  ];
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <ContentTabs active="about" done={sp.done} error={sp.error} />
      <form action={saveAboutAction} className="flex flex-col gap-6">
        <Card size="panel" className="flex flex-col gap-4">
          <h2 className="text-section">{t('about.intro')}</h2>
          <label className={field}>
            {t('about.lede')}
            <textarea name="lede" rows={2} maxLength={400} defaultValue={a.lede} className="field w-full" />
          </label>
          <label className={field}>
            {t('about.mission')}
            <textarea
              name="mission"
              rows={3}
              maxLength={800}
              defaultValue={a.mission}
              className="field w-full"
            />
          </label>
          <label className={field}>
            {t('about.story')}
            <textarea
              name="story"
              rows={8}
              maxLength={4000}
              defaultValue={a.story}
              className="field w-full"
            />
            <span className="text-caption font-normal text-ink-2">{t('about.storyHint')}</span>
          </label>
        </Card>
        <Card size="panel" className="flex flex-col gap-4">
          <h2 className="text-section">{t('about.stats')}</h2>
          {pad(a.stats, 3, { value: '', label: '' })
            .slice(0, 6)
            .map((r, i) => (
              <div key={`s${i}`} className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <input
                  name={`stats.${i}.value`}
                  maxLength={20}
                  defaultValue={r.value}
                  aria-label={t('about.statValue')}
                  placeholder={t('about.statValue')}
                  className="field w-full"
                />
                <input
                  name={`stats.${i}.label`}
                  maxLength={60}
                  defaultValue={r.label}
                  aria-label={t('about.statLabel')}
                  placeholder={t('about.statLabel')}
                  className="field w-full"
                />
              </div>
            ))}
        </Card>
        <Card size="panel" className="flex flex-col gap-4">
          <h2 className="text-section">{t('about.values')}</h2>
          {pad(a.values, 4, { title: '', text: '' })
            .slice(0, 8)
            .map((r, i) => (
              <div key={`v${i}`} className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                <input
                  name={`values.${i}.title`}
                  maxLength={80}
                  defaultValue={r.title}
                  aria-label={t('about.valueTitle')}
                  placeholder={t('about.valueTitle')}
                  className="field w-full"
                />
                <input
                  name={`values.${i}.text`}
                  maxLength={300}
                  defaultValue={r.text}
                  aria-label={t('about.valueText')}
                  placeholder={t('about.valueText')}
                  className="field w-full"
                />
              </div>
            ))}
        </Card>
        <Card size="panel" className="flex flex-col gap-4">
          <h2 className="text-section">{t('about.offer')}</h2>
          <label className={field}>
            {t('about.attendees')}
            <textarea
              name="attendees"
              rows={3}
              maxLength={800}
              defaultValue={a.attendees}
              className="field w-full"
            />
          </label>
          <label className={field}>
            {t('about.organizers')}
            <textarea
              name="organizers"
              rows={3}
              maxLength={800}
              defaultValue={a.organizers}
              className="field w-full"
            />
          </label>
        </Card>
        <Card size="panel" className="flex flex-col gap-4">
          <h2 className="text-section">{t('about.team')}</h2>
          {pad(a.team, 4, { name: '', role: '', bio: '' })
            .slice(0, 12)
            .map((r, i) => (
              <div key={`t${i}`} className="grid gap-3 sm:grid-cols-[12rem_12rem_1fr]">
                <input
                  name={`team.${i}.name`}
                  maxLength={80}
                  defaultValue={r.name}
                  aria-label={t('about.memberName')}
                  placeholder={t('about.memberName')}
                  className="field w-full"
                />
                <input
                  name={`team.${i}.role`}
                  maxLength={80}
                  defaultValue={r.role}
                  aria-label={t('about.memberRole')}
                  placeholder={t('about.memberRole')}
                  className="field w-full"
                />
                <input
                  name={`team.${i}.bio`}
                  maxLength={300}
                  defaultValue={r.bio}
                  aria-label={t('about.memberBio')}
                  placeholder={t('about.memberBio')}
                  className="field w-full"
                />
              </div>
            ))}
        </Card>
        <Card size="panel" className="flex flex-col gap-4">
          <h2 className="text-section">{t('about.cta')}</h2>
          <label className={field}>
            {t('about.ctaTitle')}
            <input name="ctaTitle" maxLength={120} defaultValue={a.ctaTitle} className="field w-full" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}>
              {t('about.ctaLabel')}
              <input name="ctaLabel" maxLength={60} defaultValue={a.ctaLabel} className="field w-full" />
            </label>
            <label className={field}>
              {t('about.ctaHref')}
              <input name="ctaHref" maxLength={300} defaultValue={a.ctaHref} className="field w-full" />
              <span className="text-caption font-normal text-ink-2">{t('about.ctaHrefHint')}</span>
            </label>
          </div>
        </Card>
        <Button type="submit" className="self-start">
          {t('save')}
        </Button>
      </form>
    </Shell>
  );
}
