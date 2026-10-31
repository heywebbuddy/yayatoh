import { Button, Card, PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { getSetting } from '@/server/platform-site.ts';
import { requireStaff } from '@/server/staff.ts';
import { saveContactSettingsAction } from '../site-actions.ts';
import { ContentTabs } from '../tabs.tsx';

/** The details on the public Contact page, and the address contact messages are emailed to. */
export default async function ContactSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const c = await getSetting(staff.actor, 'contact');
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <ContentTabs active="contact" done={sp.done} error={sp.error} />
      <Card size="panel">
        <form action={saveContactSettingsAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('contactInfo.address')}
            <textarea
              name="address"
              rows={4}
              maxLength={400}
              defaultValue={c.address}
              className="field w-full"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('contactInfo.phone')}
              <input name="phone" maxLength={60} defaultValue={c.phone} className="field w-full" />
            </label>
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('contactInfo.email')}
              <input
                name="email"
                type="email"
                maxLength={254}
                defaultValue={c.email}
                className="field w-full"
              />
              <span className="text-caption font-normal text-ink-2">{t('contactInfo.emailHint')}</span>
            </label>
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('contactInfo.supportEmail')}
              <input
                name="supportEmail"
                type="email"
                maxLength={254}
                defaultValue={c.supportEmail}
                className="field w-full"
              />
              <span className="text-caption font-normal text-ink-2">{t('contactInfo.supportEmailHint')}</span>
            </label>
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('contactInfo.hours')}
              <input name="hours" maxLength={200} defaultValue={c.hours} className="field w-full" />
            </label>
          </div>
          <Button type="submit" className="self-start">
            {t('save')}
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
