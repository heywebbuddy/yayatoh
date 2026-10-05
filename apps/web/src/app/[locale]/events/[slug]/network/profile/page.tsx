import { blockedQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { Card } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionButton } from '@/components/networking/network-forms.tsx';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { profileErrors, profileFields } from '@/components/networking/profile-fields.ts';
import { ProgramForm } from '@/components/program-form.tsx';
import { getPathname } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { optOutAction, unblockAction, updateProfileAction } from '../actions.ts';

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('networking');
  return { title: t('profile.metaTitle'), robots: { index: false, follow: false } };
}

/** Your networking profile (M5.8a): edit it, leave networking, and the people you blocked. */
export default async function NetworkProfilePage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  if (p.kind !== 'member') redirect(getPathname({ href: networkPath(slug), locale }));
  const t = await getTranslations('networking');
  const blocked = await executeQuery(blockedQuery, p.at, p.ctx, ports);
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={t('profile.title')}
      description={t('profile.intro')}
      active="profile"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      <Card className="flex flex-col gap-4">
        <h2 className="text-card">{t('profile.editHeading')}</h2>
        <ProgramForm
          action={updateProfileAction.bind(null, slug)}
          fields={await profileFields(p.home.profile, p.home.attendeeName, { consent: false })}
          idPrefix="network-profile"
          submitLabel={t('profile.save')}
          successLabel={t('profile.saved')}
          errors={await profileErrors()}
        />
      </Card>
      <section aria-labelledby="blocked-heading" className="flex flex-col gap-3">
        <h2 id="blocked-heading" className="text-section">
          {t('profile.blockedHeading')}
        </h2>
        {blocked.length === 0 ? (
          <p className="text-body text-ink-2">{t('profile.noBlocked')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {blocked.map((b) => (
              <li key={b.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-body font-bold text-ink">{b.displayName}</span>
                  <ActionButton
                    action={unblockAction.bind(null, slug, b.id)}
                    label={t('profile.unblock')}
                    accessibleName={t('profile.unblockName', { name: b.displayName })}
                    done={t('profile.unblocked', { name: b.displayName })}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="leave-heading" className="flex flex-col gap-3">
        <h2 id="leave-heading" className="text-section">
          {t('profile.leaveHeading')}
        </h2>
        <p className="text-body text-ink-2">{t('profile.leaveHelp')}</p>
        <ActionButton action={optOutAction.bind(null, slug)} label={t('profile.leave')} variant="danger" />
      </section>
    </NetworkShell>
  );
}
