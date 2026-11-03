import { DEFAULT_PAGE_STYLE, pageStyleVars, publicEventBySlug } from '@yayatoh/events';
import { cx } from '@yayatoh/ui';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties, ReactNode } from 'react';
import { ShowcaseFooter } from '@/components/showcase/footer.tsx';
import { ShowcaseTopBar } from '@/components/showcase/top-bar.tsx';
import { Link } from '@/i18n/navigation.ts';

/**
 * The frame of every page under an event (speaker, exhibitor, sponsor, networking, registration,
 * waitlist, live Q&A…): the landing page's top bar and footer, the organizer's page design
 * (`[data-ev-page]` colours, heading font, text scale) and a sticky pill that leads back to the
 * event. Pages keep their own access checks; this only reads the event's public look, falling back
 * to the default look when the event is private or unknown.
 */
export async function EventSubpageFrame({
  slug,
  eventName,
  siteName,
  backHref,
  backLabel,
  actions,
  title,
  eyebrow,
  description,
  width = 'max-w-5xl',
  card = false,
  children,
}: {
  slug: string;
  /** Shown in the back pill; read from the event when omitted. */
  eventName?: string;
  /** A tenant site's own name in place of the wordmark. */
  siteName?: string;
  /** Where the pill leads (default: the event page). */
  backHref?: string;
  backLabel?: string;
  /** Extra controls at the end of the pill (tabs live in the page, not here). */
  actions?: ReactNode;
  /** A compact hero banner like the landing page's: the page's own title (and event name above it). */
  title?: string;
  eyebrow?: string;
  description?: ReactNode;
  width?: string;
  /** Sets the page body on the landing page's section card (forms, profiles, receipts). */
  card?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations('publicEvent');
  const pub = await publicEventBySlug(slug, { includePrivate: true }).catch(() => null);
  const design = pub?.design;
  const showcase = design?.theme === 'showcase';
  const styleVars = pageStyleVars(design?.page ?? DEFAULT_PAGE_STYLE);
  const name = eventName ?? pub?.name ?? '';
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page">
      <ShowcaseTopBar {...(siteName ? { name: siteName } : {})} />
      <div
        className={cx('ev-frame', !showcase && 'bg-page')}
        data-heading={design?.headingFont}
        data-profile={pub?.profile}
        data-ev-page
        style={styleVars as CSSProperties}
        {...(showcase ? { 'data-surface': 'showcase' } : { 'data-theme': 'light' })}
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-4 pb-16 md:px-6">
          <nav aria-label={t('breadcrumb')} className="ev-subnav sticky top-[76px] z-40 -mx-1">
            <div className="flex min-h-[52px] items-center gap-2 rounded-pill border border-line bg-canvas/85 p-1.5 ps-2 backdrop-blur-xl">
              <Link
                href={backHref ?? `/events/${slug}`}
                className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-pill px-3.5 text-body font-bold text-ink-2 hover:bg-surface-3 hover:text-ink"
              >
                <ArrowLeft aria-hidden="true" className="size-4 shrink-0 rtl:-scale-x-100" />
                <span className="truncate">{backLabel ?? t('backToEvent', { name })}</span>
              </Link>
              {actions ? <div className="ms-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
            </div>
          </nav>
          {title ? (
            <section
              data-event-hero
              className="relative isolate flex flex-col justify-end gap-3 overflow-hidden rounded-card bg-hero px-6 pt-16 pb-7 text-white md:px-12 md:pt-24 md:pb-10"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute end-[6%] -top-20 -z-10 h-[360px] w-[160px] rotate-[32deg] rounded-full bg-surface/40 blur-[34px]"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -end-16 -bottom-20 -z-10 h-[220px] w-[340px] -rotate-[16deg] rounded-[56px] bg-linear-135 from-white/40 via-primary to-primary-pressed opacity-80"
              />
              {eyebrow ? (
                <p className="m-0 text-label font-bold uppercase tracking-wide text-white/80">{eyebrow}</p>
              ) : null}
              <h1 className="m-0 max-w-[820px] font-display text-[clamp(30px,5vw,56px)] leading-[0.98] font-black tracking-[-0.04em] text-balance uppercase">
                {title}
              </h1>
              {description ? (
                <p className="m-0 max-w-[600px] text-[17px] leading-relaxed text-white/90">{description}</p>
              ) : null}
            </section>
          ) : null}
          <main id="main" className={cx('mx-auto w-full', width, card ? evCard : 'flex flex-col gap-6')}>
            {children}
          </main>
        </div>
      </div>
      <ShowcaseFooter />
    </div>
  );
}

/** The landing page's card surface for a block inside an event sub-page. */
export const evCard = 'ev-card flex flex-col gap-6 rounded-card p-5 md:p-8';
