import { fakeCheckoutSignature } from '@yayatoh/billing';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { fakeCheckoutSecret } from '@/server/self-serve.ts';
import { declineFakeAction, payFakeAction } from './actions.ts';

/**
 * The fake provider's stand-in for Stripe's hosted checkout (development, preview and CI only; a
 * 404 in production or with the real provider). Its link is signed, so it only pays for what the
 * sign-up asked for.
 */
export default async function FakeCheckout({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ customer?: string; price?: string; ok?: string; no?: string; sig?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const secret = fakeCheckoutSecret();
  const q = await searchParams;
  if (!secret || !q.customer || !q.price || !q.ok || !q.no) notFound();
  const sig = fakeCheckoutSignature(secret, {
    customerId: q.customer,
    priceLookupKey: q.price,
    successUrl: q.ok,
    cancelUrl: q.no,
  });
  if (sig !== q.sig) notFound();
  const t = await getTranslations('selfServe.fake');
  const hidden = (
    <>
      <input type="hidden" name="customer" value={q.customer} />
      <input type="hidden" name="price" value={q.price} />
      <input type="hidden" name="ok" value={q.ok} />
      <input type="hidden" name="no" value={q.no} />
      <input type="hidden" name="sig" value={q.sig} />
    </>
  );
  return (
    <ShowcaseShell>
      <section
        aria-labelledby="fake-h"
        className="mx-auto flex w-full max-w-xl flex-col gap-5 rounded-[36px] border border-line bg-surface p-8 md:p-12"
      >
        <p className="m-0 text-caption font-bold tracking-widest text-ember uppercase">{t('eyebrow')}</p>
        <h1
          id="fake-h"
          className="m-0 font-display text-[clamp(1.6rem,3.5vw,2.4rem)] leading-tight font-black text-ink uppercase"
        >
          {t('title')}
        </h1>
        <p className="m-0 text-body text-ink-2">{t('body', { price: q.price })}</p>
        <div className="flex flex-wrap gap-3">
          <form action={payFakeAction}>
            {hidden}
            <button type="submit" className="min-h-12 rounded-pill bg-ember-soft px-6 font-bold text-white">
              {t('pay')}
            </button>
          </form>
          <form action={declineFakeAction}>
            {hidden}
            <button
              type="submit"
              className="min-h-12 rounded-pill border border-line-strong px-6 font-bold text-ink"
            >
              {t('decline')}
            </button>
          </form>
        </div>
      </section>
    </ShowcaseShell>
  );
}
