import { permanentRedirect } from 'next/navigation';
import { localizedPath } from '@/lib/seo/urls.ts';

/** The old pricing and fees page: plans and the per-ticket fee now live on sign-up. Old links land there. */
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  permanentRedirect(localizedPath(locale, '/signup'));
}
