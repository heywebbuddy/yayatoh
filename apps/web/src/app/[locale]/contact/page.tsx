import { LifeBuoy, Mail, Radio } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ContactForm } from '@/components/marketing/contact-form.tsx';
import { SiteSections } from '@/components/marketing/site-sections.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { PageHero } from '@/components/showcase/page-hero.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedSections, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { humanCheckWidget } from '@/server/seat-finder.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';
import { contactAction } from './actions.ts';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const req = await requestHost();
  const t = await getTranslations({ locale, namespace: 'marketing' });
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/contact',
    title: t('contact.metaTitle'),
    description: t('contact.lede'),
    image: `${req.origin}/api/og/home`,
  });
}

/** Contact and sales (M3.11b): the CMS's `contact` sections beside the form. */
export default async function Contact({ params }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const org = await platformContentOrg(await requestHost());
  const t = await getTranslations('marketing');
  const tp = await getTranslations('pages');
  if (!org) {
    // No content org to receive form requests: the contact address, help and status instead.
    const email = process.env.PLATFORM_CONTACT_EMAIL?.trim() || 'support@yayatoh.com';
    return (
      <div className="min-h-dvh bg-surface">
        <SiteHeader />
        <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-6">
          <PageHero
            eyebrow={tp('eyebrow.contact')}
            title={t('contact.title')}
            lede={t('contact.lede')}
            icon={Mail}
          />
          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6">
            <p className="m-0 text-body text-ink-2">{t('contact.fallbackBody')}</p>
            <a
              href={`mailto:${email}`}
              className="self-start text-card font-extrabold underline underline-offset-4"
            >
              {email}
            </a>
            <Link href="/help" className="self-start text-body underline underline-offset-4">
              {t('contact.fallbackHelp')}
            </Link>
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }
  const sections = await cachedSections(org.orgId, 'contact', locale);
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 md:px-6">
        <PageHero
          eyebrow={tp('eyebrow.contact')}
          title={t('contact.title')}
          lede={t('contact.lede')}
          icon={Mail}
        />
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3">
          {(
            [
              ['form', '#contact-form-title', Mail],
              ['help', '/help', LifeBuoy],
              ['status', '/status', Radio],
            ] as const
          ).map(([k, href, Icon]) => (
            <li key={k}>
              <Link
                href={href}
                className="flex h-full flex-col gap-2 rounded-card border border-line bg-surface p-5 transition duration-300 hover:-translate-y-1 hover:border-ember motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="grid size-10 place-items-center rounded-full bg-ember text-white">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="text-[17px] font-extrabold">{tp(`channel.${k}.title`)}</span>
                <span className="text-body text-ink-2">{tp(`channel.${k}.desc`)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <SiteSections sections={sections} layout="stack" locale={locale} />
          <section
            aria-labelledby="contact-form-title"
            className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6"
          >
            <h2 id="contact-form-title" className="text-[24px] font-extrabold tracking-[-0.02em]">
              {t('contact.formTitle')}
            </h2>
            <ContactForm action={contactAction} humanCheck={humanCheckWidget()} />
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
