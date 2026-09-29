import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ContactForm } from '@/components/marketing/contact-form.tsx';
import { SiteSections } from '@/components/marketing/site-sections.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
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
  if (!(await platformContentOrg(req))) return {};
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
  if (!org) notFound();
  const t = await getTranslations('marketing');
  const sections = await cachedSections(org.orgId, 'contact', locale);
  return (
    <div className="min-h-dvh bg-white">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:px-6 md:py-16">
        <header className="flex flex-col gap-3">
          <h1 className="text-[40px] leading-tight font-light tracking-[-0.045em]">{t('contact.title')}</h1>
          <p className="max-w-2xl text-[17px] text-zinc-600">{t('contact.lede')}</p>
        </header>
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <SiteSections sections={sections} layout="stack" locale={locale} />
          <section aria-labelledby="contact-form-title" className="flex min-w-0 flex-col gap-4">
            <h2 id="contact-form-title" className="text-[24px] font-normal tracking-[-0.02em]">
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
