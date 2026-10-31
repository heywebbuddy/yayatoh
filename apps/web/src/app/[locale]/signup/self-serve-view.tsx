import { billingEnabled, publicPlanTiers } from '@yayatoh/billing';
import { formatMoney, money } from '@yayatoh/kernel';
import { getTranslations } from 'next-intl/server';
import { MaskLines } from '@/components/organizers/motion.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { type PlanCard, SelfServeSignup } from '@/components/signup/self-serve.tsx';
import { humanCheckWidget } from '@/server/human-check.ts';
import { ownAuthSession } from '@/server/session.ts';
import { applyAction } from '../for-organizers/actions.ts';
import { selfServeAction } from './self-serve-actions.ts';

const TIERS = [
  { id: 'free', key: 'tier_free', blurb: 'selfServe.free.body', name: 'selfServe.free.name' },
  {
    id: 'starter',
    key: 'tier_starter',
    blurb: 'forOrganizers.plans.starter.body',
    name: 'forOrganizers.plans.starter.name',
  },
  { id: 'pro', key: 'tier_pro', blurb: 'forOrganizers.plans.pro.body', name: 'forOrganizers.plans.pro.name' },
  {
    id: 'agency',
    key: 'tier_agency',
    blurb: 'forOrganizers.plans.white_label.body',
    name: 'forOrganizers.plans.white_label.name',
  },
] as const;
const HIGHLIGHTS = ['ticketing', 'website', 'checkin', 'chat', 'ai', 'donations', 'whitelabel'] as const;

/** The self-service sign-up page (open sign-up on): plans from the live catalog, then account and payment. */
export async function SelfServeView({
  locale,
  plan,
  interval,
}: {
  locale: string;
  plan: string;
  interval: 'month' | 'year';
}) {
  const t = await getTranslations();
  const [session, tiers] = await Promise.all([ownAuthSession(), publicPlanTiers()]);
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const payments = billingEnabled();
  const cards: PlanCard[] = TIERS.map((p) => {
    const tier = tiers.find((x) => x.key === p.key);
    const m = tier?.prices.find((x) => x.interval === 'month');
    const y = tier?.prices.find((x) => x.interval === 'year');
    const free = Boolean(m && m.unitAmountMinor === 0);
    const priced = Boolean(tier?.active && (m ?? y));
    return {
      key: p.key,
      id: p.id,
      name: t(p.name),
      blurb: t(p.blurb),
      monthly: m ? fmt(m.unitAmountMinor, m.currency) : null,
      yearly: y ? fmt(y.unitAmountMinor, y.currency) : null,
      yearlyPerMonth: y ? fmt(Math.round(y.unitAmountMinor / 12), y.currency) : null,
      free,
      // Paid plans are sold only while online payment is switched on; Free never needs it.
      available: priced && (free || payments),
      soon: priced && !free && !payments,
      highlights: HIGHLIGHTS.filter((h) => tier?.modules.includes(h))
        .slice(0, 5)
        .map((h) => t(`forOrganizers.modules.${h}`)),
    };
  });
  const unknownPlan = plan !== '' && !TIERS.some((p) => p.id === plan);
  const paidOnSale = cards.some((c) => !c.free && c.available);
  const notice = unknownPlan ? 'planUnknown' : paidOnSale ? null : 'paidSoon';
  return (
    <ShowcaseShell>
      <header className="relative isolate flex flex-col gap-5 overflow-hidden rounded-[40px] border border-line bg-surface p-6 md:p-12">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-24 -z-10 size-96 rounded-full bg-ember opacity-30 blur-3xl animate-breathe motion-reduce:animate-none"
        />
        <p className="m-0 text-caption font-bold tracking-widest text-ember uppercase">
          {t('selfServe.eyebrow')}
        </p>
        <MaskLines
          as="h1"
          lines={[t('selfServe.line1'), t('selfServe.line2')]}
          className="m-0 font-display text-[clamp(2.2rem,6.5vw,5rem)] leading-[0.95] font-black tracking-[-0.04em] text-ink uppercase"
        />
        <p className="m-0 max-w-2xl text-[17px] leading-relaxed text-ink-2">{t('selfServe.lede')}</p>
      </header>
      <SelfServeSignup
        action={selfServeAction}
        plans={cards}
        initialPlan={plan}
        initialInterval={interval}
        notice={notice}
        signedInEmail={session?.user.email ?? null}
        humanCheck={humanCheckWidget()}
        sales={{ action: applyAction, humanCheck: humanCheckWidget() }}
        defaultCountry="US"
      />
    </ShowcaseShell>
  );
}
