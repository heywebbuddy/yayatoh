import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { orgContactAction } from '@/app/[locale]/organizers/[slug]/contact/actions.ts';
import { formStamp } from '@/lib/contact-spam.ts';
import { cachedContactPage, contactPublicUrl } from '@/server/cms.ts';
import { requestHost } from '@/server/request-origin.ts';
import { humanCheckWidget } from '@/server/seat-finder.ts';
import { publicMetadata } from '@/server/seo.ts';
import { OrgContactForm } from './org-contact-form.tsx';
import { Chrome, type ContentSite } from './public-views.tsx';

/**
 * U10: an org's contact page (its tenant site's `/contact`, `/o/{slug}/contact` on the
 * marketplace). A 404 while the organizer has it off. The page names the org and its line of
 * text and nothing else: no address of the org is ever on it (the canary crawl checks).
 */
export async function ContactView({ site }: { site: ContentSite }) {
  const page = await cachedContactPage(site.org.orgId);
  if (!page) notFound();
  const t = await getTranslations('orgContact');
  const stamp = formStamp(process.env.APP_TOKEN_SECRET ?? '', site.org.orgId, Date.now());
  return (
    <Chrome site={site} current="/contact">
      <header className="flex flex-col gap-3">
        <h1 className="break-words text-[40px] leading-tight font-extrabold tracking-[-0.03em]">
          {t('title', { org: site.org.name })}
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          {page.intro ?? t('defaultIntro', { org: site.org.name })}
        </p>
      </header>
      <OrgContactForm
        action={orgContactAction.bind(null, site.variant === 'tenant' ? null : site.org.slug)}
        orgName={site.org.name}
        stamp={stamp}
        submissionKey={crypto.randomUUID()}
        humanCheck={humanCheckWidget()}
      />
    </Chrome>
  );
}

export async function contactMetadata(site: ContentSite | null, locale: string): Promise<Metadata> {
  if (!site || !(await cachedContactPage(site.org.orgId))) return {};
  const t = await getTranslations({ locale, namespace: 'orgContact' });
  const req = await requestHost();
  const url = new URL(contactPublicUrl(req, site.org));
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: url.origin,
    path: url.pathname,
    title: t('title', { org: site.org.name }),
    description: t('defaultIntro', { org: site.org.name }),
    image: `${req.origin}/api/og/org/${site.org.slug}`,
  });
}
