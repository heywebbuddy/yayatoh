import { type EventTarget, holderEventContent } from '@yayatoh/events';
import { buttonClass, Card } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Announcements } from './announcements.tsx';
import { Markdown } from './markdown.tsx';

/**
 * What only verified ticket holders see (M1.4d): the organizer's private info, the online join
 * link inside its window, and every published announcement. Render it only after the page has
 * verified the manage/holder link and that the visitor still holds a live ticket.
 */
export async function HolderContent({
  target,
  locale,
  timeZone,
}: {
  target: EventTarget;
  locale: string;
  timeZone: string;
}) {
  const content = await holderEventContent(target);
  if (!content) return null;
  const t = await getTranslations('holder');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const online = content.attendanceMode !== 'in_person';
  const hasJoin = content.joinUrl || content.joinOpensAt || content.joinClosed;
  if (!content.privateInfo && !hasJoin && content.announcements.length === 0) return null;
  return (
    <>
      {online && hasJoin ? (
        <section aria-labelledby="join-heading" className="flex flex-col gap-3">
          <h2 id="join-heading" className="text-section">
            {t('joinTitle')}
          </h2>
          <Card className="flex flex-col gap-3">
            {content.joinUrl ? (
              <>
                <p className="text-body">{t('joinOpen')}</p>
                <a
                  href={content.joinUrl}
                  rel="noopener noreferrer"
                  className={buttonClass('primary', 'md', 'self-start')}
                >
                  {t('joinButton')}
                </a>
              </>
            ) : content.joinOpensAt ? (
              <p className="text-body">{t('joinOpensAt', { when: when.format(content.joinOpensAt) })}</p>
            ) : (
              <p className="text-body">{t('joinClosed')}</p>
            )}
          </Card>
        </section>
      ) : null}
      {content.privateInfo ? (
        <section aria-labelledby="private-info-heading" className="flex flex-col gap-3">
          <h2 id="private-info-heading" className="text-section">
            {t('privateInfoTitle')}
          </h2>
          <Card>
            <Markdown source={content.privateInfo} />
          </Card>
        </section>
      ) : null}
      {content.announcements.length > 0 ? (
        <section aria-labelledby="holder-announcements-heading" className="flex flex-col gap-3">
          <h2 id="holder-announcements-heading" className="text-section">
            {t('announcementsTitle')}
          </h2>
          <Announcements items={content.announcements} locale={locale} timeZone={timeZone} showAudience />
        </section>
      ) : null}
    </>
  );
}
