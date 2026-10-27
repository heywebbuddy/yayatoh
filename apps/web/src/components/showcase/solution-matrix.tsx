import { PROFILES } from '@yayatoh/platform';
import { cx } from '@yayatoh/ui';
import { Check, Minus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SOLUTION_KEYS, SOLUTIONS, type SolutionKey } from './solutions.ts';

/** The rows: platform modules, in the order a visitor thinks of them. */
export const MATRIX_MODULES = [
  'ticketing',
  'registration',
  'seating',
  'donations',
  'guests',
  'rsvp',
  'sessions',
  'speakers',
  'exhibitors',
  'badges',
  'checkin',
  'marketing',
  'messaging',
  'gallery',
  'website',
  'virtual',
  'reports',
] as const;

/** Whether a vertical's profile ships the module by default or lists its page in its navigation. */
export function includes(vertical: SolutionKey, module: string): boolean {
  const p = PROFILES[SOLUTIONS[vertical].profile];
  return p.defaultModules.includes(module as never) || p.nav.some((n) => n.module === module);
}

/**
 * Feature by event type: every row is a real platform module and every cell reads the event
 * profile's own configuration, so the grid cannot drift from what the product does. The page's own
 * type is highlighted.
 */
export async function SolutionMatrix({ current }: { current: SolutionKey }) {
  const t = await getTranslations('showcase.matrix');
  const ts = await getTranslations('showcase.solutions');
  return (
    <section aria-labelledby="matrix-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2
          id="matrix-title"
          className="font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px]"
        >
          {t('title')}
        </h2>
        <p className="m-0 max-w-2xl text-body text-ink-2">{t('lede')}</p>
      </div>
      <div className="no-scrollbar overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[640px] border-collapse text-body">
          <thead>
            <tr className="bg-surface-2 text-start">
              <th
                scope="col"
                className="px-4 py-3 text-start text-label font-extrabold tracking-[0.1em] uppercase"
              >
                {t('feature')}
              </th>
              {SOLUTION_KEYS.map((k) => (
                <th
                  key={k}
                  scope="col"
                  className={cx(
                    'px-3 py-3 text-center text-[13px] font-extrabold',
                    k === current && 'bg-primary-soft text-primary-ink',
                  )}
                >
                  {ts(`${k}.name`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_MODULES.map((m) => (
              <tr key={m} className="border-t border-line">
                <th scope="row" className="px-4 py-2.5 text-start font-bold">
                  {t(`modules.${m}`)}
                </th>
                {SOLUTION_KEYS.map((k) => {
                  const yes = includes(k, m);
                  return (
                    <td
                      key={k}
                      className={cx('px-3 py-2.5 text-center', k === current && 'bg-primary-soft/40')}
                    >
                      {yes ? (
                        <Check aria-hidden="true" className="mx-auto size-5 text-lime" strokeWidth={3} />
                      ) : (
                        <Minus aria-hidden="true" className="mx-auto size-4 text-ink-3" />
                      )}
                      <span className="sr-only">{yes ? t('included') : t('notIncluded')}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
