import { platformContactSettings } from '@yayatoh/cms';
import { Clock, LifeBuoy, Mail, MapPin, Phone, Radio } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ContactForm } from '@/components/marketing/contact-form.tsx';
import { PageHero } from '@/components/showcase/page-hero.tsx';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { Link } from '@/i18n/navigation.ts';
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

const panel = 'flex min-w-0 flex-col gap-6 rounded-[28px] border border-line bg-surface p-6 md:p-8';
const h2 = 'm-0 font-display text-[26px] leading-tight font-black tracking-[-0.02em] uppercase';
const link = 'underline underline-offset-4';

/** Contact: the details staff keep in the admin console beside a form whose messages reach their inbox. */
export default async function Contact({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('marketing');
  const tp = await getTranslations('pages');
  const tc = await getTranslations('sitePages.contact');
  const c = await platformContactSettings();
  const details: { key: string; Icon: typeof Mail; label: string; value: ReactNode }[] = [];
  if (c.address)
    details.push({
      key: 'address',
      Icon: MapPin,
      label: tc('address'),
      value: <p className="m-0 whitespace-pre-line">{c.address}</p>,
    });
  if (c.phone)
    details.push({
      key: 'phone',
      Icon: Phone,
      label: tc('phone'),
      value: (
        <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`} dir="ltr" className={link}>
          {c.phone}
        </a>
      ),
    });
  if (c.email)
    details.push({
      key: 'email',
      Icon: Mail,
      label: tc('email'),
      value: (
        <a href={`mailto:${c.email}`} dir="ltr" className={link}>
          {c.email}
        </a>
      ),
    });
  if (c.hours)
    details.push({ key: 'hours', Icon: Clock, label: tc('hours'), value: <p className="m-0">{c.hours}</p> });
  return (
    <ShowcaseShell width="max-w-6xl">
      <PageHero
        eyebrow={tp('eyebrow.contact')}
        title={t('contact.title')}
        lede={t('contact.lede')}
        icon={Mail}
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.2fr]">
        <Reveal as="section" className={panel}>
          <h2 className={h2}>{tc('getInTouch')}</h2>
          <ul className="m-0 flex list-none flex-col gap-5 p-0">
            {details.map(({ key, Icon, label, value }) => (
              <li key={key} className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ember text-white">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5 text-body text-ink-2 [overflow-wrap:anywhere]">
                  <span className="text-caption font-bold tracking-widest text-ink uppercase">{label}</span>
                  {value}
                </div>
              </li>
            ))}
          </ul>
          <ul className="m-0 flex list-none flex-wrap gap-x-6 p-0 text-body">
            <li>
              <Link
                href="/help"
                className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4"
              >
                <LifeBuoy aria-hidden="true" className="size-4" />
                {tp('channel.help.title')}
              </Link>
            </li>
            <li>
              <Link
                href="/status"
                className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4"
              >
                <Radio aria-hidden="true" className="size-4" />
                {tp('channel.status.title')}
              </Link>
            </li>
          </ul>
        </Reveal>
        <Reveal as="section" className={panel}>
          <h2 id="contact-form-title" className={h2}>
            {t('contact.formTitle')}
          </h2>
          <ContactForm action={contactAction} humanCheck={humanCheckWidget()} />
        </Reveal>
      </div>
    </ShowcaseShell>
  );
}
