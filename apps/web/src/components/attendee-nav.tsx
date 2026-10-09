'use client';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation.ts';
import { ATTENDEE_SECTIONS } from '@/lib/attendee.ts';

export function AttendeeNav() {
  const t = useTranslations('attendeeDashboard');
  const path = usePathname();
  return (
    <nav aria-label={t('navigation')} className="flex min-w-0 flex-wrap gap-2 lg:flex-col">
      {ATTENDEE_SECTIONS.map((section) => {
        const href = section === 'overview' ? '/attendee' : `/attendee/${section}`;
        return (
          <Link
            key={section}
            href={href}
            aria-current={path === href ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded-control px-4 py-2 text-body font-bold text-ink-2 hover:bg-surface-3 aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-ink"
          >
            {t(`nav.${section}`)}
          </Link>
        );
      })}
    </nav>
  );
}
