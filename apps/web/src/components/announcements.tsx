import type { PublicAnnouncementDto } from '@yayatoh/events';
import { Card, Label } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Markdown } from './markdown.tsx';

/** Published announcements, pinned first (public page and attendee portal). */
export async function Announcements({
  items,
  locale,
  timeZone,
  showAudience = false,
}: {
  items: readonly PublicAnnouncementDto[];
  locale: string;
  timeZone: string;
  showAudience?: boolean;
}) {
  const t = await getTranslations('eventAnnouncements');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  return (
    <ul className="flex list-none flex-col gap-3 p-0">
      {items.map((a) => (
        <li key={a.id}>
          <Card className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {a.pinned ? <Label>{t('pinned')}</Label> : null}
              {showAudience && a.audience === 'holders' ? <Label>{t('holdersOnly')}</Label> : null}
              {a.publishedAt ? (
                <time dateTime={a.publishedAt.toISOString()} className="text-caption text-zinc-500">
                  {when.format(a.publishedAt)}
                </time>
              ) : null}
            </div>
            <h3 className="text-section">{a.title}</h3>
            <Markdown source={a.body} />
          </Card>
        </li>
      ))}
    </ul>
  );
}
