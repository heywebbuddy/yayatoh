import { TriangleAlert, Wrench } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin } from '@/server/seo.ts';
import { statusBanner } from '@/server/status.ts';

/**
 * Shown on every console and marketplace page while an incident or a maintenance window is open
 * (M3.11b): the most severe one, how many more, and a link to the status page. The text is the
 * incident's own title as the status page shows it.
 */
export async function IncidentBanner({ variant }: { variant: 'console' | 'site' }) {
  const banner = await statusBanner();
  if (!banner) return null;
  const t = await getTranslations('status');
  const maintenance = banner.impact === 'maintenance';
  const Icon = maintenance ? Wrench : TriangleAlert;
  const href = `${apexOrigin(await requestHost())}/status`;
  return (
    <section
      aria-label={t('banner.label')}
      data-testid="incident-banner"
      className={`flex items-start gap-3 border-b px-4 py-3 ${
        maintenance
          ? 'border-zinc-200 bg-zinc-50 text-zinc-800'
          : 'border-pink-700/30 bg-pink-50 text-pink-700'
      } ${variant === 'console' ? 'md:px-8' : 'md:px-6'}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-body font-medium break-words">
          {t(maintenance ? 'banner.maintenance' : 'banner.incident', { title: banner.title })}
        </p>
        <p className="text-body">
          {banner.others > 0 ? `${t('banner.others', { count: banner.others })} ` : null}
          <a href={href} className="inline-flex min-h-6 items-center underline underline-offset-2">
            {t('banner.link')}
          </a>
        </p>
      </div>
    </section>
  );
}
