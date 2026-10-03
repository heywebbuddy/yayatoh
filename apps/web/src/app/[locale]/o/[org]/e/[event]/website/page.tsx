import { LOCALES } from '@yayatoh/contracts';
import {
  guestSiteQuery,
  MAX_BLOCK_ITEMS,
  MAX_SITE_BLOCKS,
  SITE_BLOCK_KINDS,
  SITE_PASSWORD_MIN,
  type SiteBlockDto,
  subEventsQuery,
} from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import { Alert, buttonClass, Card, CardHeader, EmptyState, PageHeader, StatusPill } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { CopyLink } from '../guests/rsvp/copy-link.tsx';
import { appOrigin } from '../guests/rsvp/links.ts';
import {
  addBlockAction,
  moveBlockAction,
  publishSiteAction,
  removeBlockAction,
  saveSiteAction,
  setPasswordAction,
  updateBlockAction,
} from './actions.ts';

/**
 * The guest website (M4.5a): the hosts build a page for their guests from blocks (a welcome, the
 * program from the sub-events, travel, registry links, FAQ), set the password printed on the
 * invitations and publish it at `/w/{code}`. It is never indexed and never on the marketplace
 * (P4-3c). Hosts, co-hosts and planners with `guests:write` edit; viewers read.
 */
export default async function WebsitePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'website');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'website');
  if (!nav || !navIncludes(profile, data.modules, 'website') || !can('guests:read')) notFound();
  const t = await getTranslations('guestSiteHost');
  const tr = await getTranslations();
  const canWrite = can('guests:write');
  const [site, subEvents] = await Promise.all([
    executeQuery(guestSiteQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(subEventsQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const published = site.status === 'published';
  const url = site.code ? `${appOrigin()}/w/${site.code}` : null;
  const languages = new Intl.DisplayNames([locale], { type: 'language' });
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: ev.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);

  const errors = {
    title: t('errors.title'),
    password: t('errors.password'),
    too_short: t('errors.tooShort', { min: SITE_PASSWORD_MIN }),
    too_long: t('errors.tooLong'),
    password_required: t('errors.passwordRequired'),
    too_many_blocks: t('errors.tooManyBlocks', { max: MAX_SITE_BLOCKS }),
    https_only: t('errors.httpsOnly'),
    subEventIds: t('errors.subEvents'),
    unknown: t('errors.subEvents'),
    too_small: t('errors.required'),
  };

  const blockFields = (b: SiteBlockDto): FieldSpec[] => {
    const heading: FieldSpec = {
      kind: 'text',
      name: 'heading',
      label: t('fields.heading'),
      hint: t('fields.headingHint', { kind: t(`kinds.${b.kind}`) }),
      defaultValue: b.heading ?? '',
      maxLength: 120,
    };
    if (b.kind === 'text')
      return [
        heading,
        {
          kind: 'textarea',
          name: 'body',
          label: t('fields.body'),
          hint: t('fields.bodyHint'),
          defaultValue: b.content.body,
          rows: 6,
        },
      ];
    if (b.kind === 'program')
      return [
        heading,
        {
          kind: 'select',
          name: 'show',
          label: t('fields.show'),
          hint: t('fields.showHint'),
          defaultValue: b.content.show,
          options: [
            { value: 'everyone', label: t('show.everyone') },
            { value: 'chosen', label: t('show.chosen') },
          ],
        },
        {
          kind: 'checkboxes',
          name: 'subEventIds',
          label: t('fields.subEvents'),
          defaultValues: b.content.subEventIds,
          options: subEvents.map((s) => ({
            value: s.id,
            label: s.inviteAll ? t('subEventEveryone', { name: s.name }) : s.name,
          })),
        },
      ];
    const items = b.content.items as readonly Record<string, string | null>[];
    // Every saved row plus one blank one (until the limit): fill it in to add an item, clear a row
    // to remove it.
    const count = Math.min(items.length + 1, MAX_BLOCK_ITEMS);
    const spec: Record<typeof b.kind, readonly { name: string; kind: 'text' | 'url' | 'textarea' }[]> = {
      travel: [
        { name: 'title', kind: 'text' },
        { name: 'details', kind: 'textarea' },
        { name: 'url', kind: 'url' },
      ],
      registry: [
        { name: 'label', kind: 'text' },
        { name: 'url', kind: 'url' },
      ],
      faq: [
        { name: 'question', kind: 'text' },
        { name: 'answer', kind: 'textarea' },
      ],
    };
    const fields: FieldSpec[] = [heading];
    for (let i = 0; i < count; i++)
      for (const f of spec[b.kind])
        fields.push(
          f.kind === 'textarea'
            ? {
                kind: 'textarea',
                name: `i:${i}:${f.name}`,
                label: t(`item.${b.kind}.${f.name}`, { n: i + 1 }),
                defaultValue: items[i]?.[f.name] ?? '',
                rows: 3,
              }
            : {
                kind: f.kind,
                name: `i:${i}:${f.name}`,
                label: t(`item.${b.kind}.${f.name}`, { n: i + 1 }),
                defaultValue: items[i]?.[f.name] ?? '',
                maxLength: f.kind === 'url' ? 500 : 200,
                ...(f.kind === 'url' ? { hint: t('fields.urlHint') } : {}),
              },
        );
    return fields;
  };

  return (
    <>
      <PageHeader
        title={tr(navLabelKey(profile, nav))}
        description={t('subtitle')}
        actions={
          published && url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center rounded-pill border border-line bg-surface px-4 text-body font-bold text-ink"
            >
              {t('open')}
            </a>
          ) : null
        }
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}

      <section aria-labelledby="site-status-heading">
        <Card size="panel" className="flex flex-col gap-4">
          <CardHeader
            id="site-status-heading"
            title={t('statusTitle')}
            actions={
              <StatusPill
                tone={published ? 'success' : 'neutral'}
                label={published ? t('published') : t('draft')}
              />
            }
          />
          <p className="m-0 text-body text-ink-2" data-testid="site-status">
            {published && site.publishedAt
              ? t('publishedNote', { date: fmt(site.publishedAt) })
              : site.hasPassword
                ? t('draftNote')
                : t('needsPassword')}
          </p>
          {published && url ? <CopyLink label={t('address')} url={url} /> : null}
          <p className="m-0 text-caption text-ink-2">{t('privacyNote')}</p>
          {canWrite ? (
            <ProgramForm
              action={publishSiteAction.bind(null, org, event, !published)}
              fields={[]}
              idPrefix="site-publish"
              submitLabel={published ? t('unpublish') : t('publish')}
              successLabel={published ? t('publishedDone') : t('unpublishedDone')}
              errors={errors}
            />
          ) : null}
        </Card>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section aria-labelledby="site-password-heading">
          <Card size="panel" className="flex flex-col gap-4">
            <CardHeader
              id="site-password-heading"
              title={t('passwordTitle')}
              actions={
                <StatusPill
                  tone={site.hasPassword ? 'success' : 'waiting'}
                  label={site.hasPassword ? t('passwordSet') : t('passwordMissing')}
                />
              }
            />
            <p className="m-0 text-body text-ink-2">{t('passwordIntro')}</p>
            {canWrite ? (
              <ProgramForm
                action={setPasswordAction.bind(null, org, event)}
                fields={[
                  {
                    kind: 'text',
                    name: 'password',
                    label: site.hasPassword ? t('fields.newPassword') : t('fields.password'),
                    hint: t('fields.passwordHint', { min: SITE_PASSWORD_MIN }),
                    maxLength: 72,
                    required: true,
                  },
                ]}
                idPrefix="site-password"
                submitLabel={t('savePassword')}
                successLabel={t('passwordSaved')}
                errors={errors}
                reset
              />
            ) : null}
          </Card>
        </section>

        <section aria-labelledby="site-details-heading">
          <Card size="panel" className="flex flex-col gap-4">
            <CardHeader id="site-details-heading" title={t('detailsTitle')} />
            {canWrite ? (
              <ProgramForm
                action={saveSiteAction.bind(null, org, event)}
                fields={[
                  {
                    kind: 'text',
                    name: 'title',
                    label: t('fields.title'),
                    defaultValue: site.title,
                    maxLength: 120,
                    required: true,
                  },
                  {
                    kind: 'textarea',
                    name: 'intro',
                    label: t('fields.intro'),
                    defaultValue: site.intro ?? '',
                    rows: 3,
                  },
                  {
                    kind: 'select',
                    name: 'contentLocale',
                    label: t('fields.language'),
                    hint: t('fields.languageHint'),
                    defaultValue: site.contentLocale,
                    options: LOCALES.map((l) => ({ value: l, label: languages.of(l) ?? l })),
                  },
                ]}
                idPrefix="site-details"
                submitLabel={t('saveDetails')}
                successLabel={t('detailsSaved')}
                errors={errors}
              />
            ) : (
              <dl className="m-0 flex flex-col gap-1 text-body">
                <dt className="font-bold text-ink-2">{t('fields.title')}</dt>
                <dd className="m-0">{site.title}</dd>
              </dl>
            )}
          </Card>
        </section>
      </div>

      <section aria-labelledby="site-blocks-heading" className="flex flex-col gap-4">
        <h2 id="site-blocks-heading" className="m-0 text-section text-ink">
          {t('blocksTitle', { count: site.blocks.length })}
        </h2>
        {site.blocks.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={canWrite ? t('emptyWrite') : t('emptyRead')}
            action={
              canWrite ? (
                <a href="#site-add-heading" className={buttonClass('primary', 'md')}>
                  {t('addTitle')}
                </a>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('secondary', 'md')}>
                  {tr('emptyActions.eventHome')}
                </Link>
              )
            }
          />
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {site.blocks.map((b, i) => {
              const name = b.heading || t(`kinds.${b.kind}`);
              return (
                <li key={b.id}>
                  <Card size="panel">
                    <article aria-labelledby={`block-${b.id}`} className="flex flex-col gap-4">
                      <CardHeader
                        as="h3"
                        id={`block-${b.id}`}
                        title={name}
                        meta={t('kindLabel', { kind: t(`kinds.${b.kind}`), n: i + 1 })}
                      />
                      {b.kind === 'program' && subEvents.length === 0 ? (
                        <p className="m-0 text-body text-ink-2">{t('noSubEvents')}</p>
                      ) : null}
                      {canWrite ? (
                        <>
                          <ProgramForm
                            action={updateBlockAction.bind(null, org, event, b.id, b.kind)}
                            fields={blockFields(b)}
                            idPrefix={`block-${b.id}`}
                            submitLabel={t('saveBlock', { name })}
                            successLabel={t('blockSaved')}
                            errors={errors}
                          />
                          <div className="flex flex-wrap items-start gap-3 border-t border-line pt-4">
                            {i > 0 ? (
                              <ProgramForm
                                action={moveBlockAction.bind(null, org, event, b.id, 'up')}
                                fields={[]}
                                idPrefix={`up-${b.id}`}
                                submitLabel={t('moveUp', { name })}
                                successLabel={t('moved')}
                                errors={errors}
                              />
                            ) : null}
                            {i < site.blocks.length - 1 ? (
                              <ProgramForm
                                action={moveBlockAction.bind(null, org, event, b.id, 'down')}
                                fields={[]}
                                idPrefix={`down-${b.id}`}
                                submitLabel={t('moveDown', { name })}
                                successLabel={t('moved')}
                                errors={errors}
                              />
                            ) : null}
                            <ProgramForm
                              action={removeBlockAction.bind(null, org, event, b.id)}
                              fields={[]}
                              idPrefix={`remove-${b.id}`}
                              submitLabel={t('removeBlock', { name })}
                              successLabel={t('removed')}
                              errors={errors}
                            />
                          </div>
                        </>
                      ) : null}
                    </article>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
        {canWrite && site.blocks.length < MAX_SITE_BLOCKS ? (
          <Card size="panel" className="flex flex-col gap-4">
            <CardHeader as="h3" id="site-add-heading" title={t('addTitle')} />
            <ProgramForm
              action={addBlockAction.bind(null, org, event)}
              fields={[
                {
                  kind: 'select',
                  name: 'kind',
                  label: t('fields.kind'),
                  hint: t('fields.kindHint'),
                  defaultValue: site.blocks.length === 0 ? 'text' : 'faq',
                  options: SITE_BLOCK_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) })),
                },
              ]}
              idPrefix="site-add"
              submitLabel={t('addBlock')}
              successLabel={t('blockAdded')}
              errors={errors}
            />
          </Card>
        ) : null}
      </section>
    </>
  );
}
