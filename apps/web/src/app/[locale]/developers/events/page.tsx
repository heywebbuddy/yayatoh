import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CodeBlock } from '@/components/developers/code-block.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';
import { eventDocs } from '@/server/developer-docs.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'developers' });
  return { title: t('events.title') };
}

/** The webhook event catalog: every public event, its versioned schema and an example message. */
export default async function EventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('developers');
  const tw = await getTranslations('webhooks');
  const groups = eventDocs();
  return (
    <>
      <PageHeader title={t('events.title')} description={t('events.subtitle')} />
      <p className="text-body">
        <Link href="/developers/guides/webhooks" className="underline underline-offset-2">
          {t('events.verifyLink')}
        </Link>
      </p>
      <nav aria-label={t('events.groups')}>
        <ul className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <li key={g.group}>
              <a
                href={`#group-${g.group}`}
                className="inline-flex min-h-8 items-center rounded-pill border border-line bg-surface-solid px-3 text-caption hover:bg-surface-2"
              >
                {tw(`groups.${g.group}` as 'groups.orders')}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {groups.map((g) => (
        <section key={g.group} aria-labelledby={`group-${g.group}`} className="flex flex-col gap-4">
          <h2 id={`group-${g.group}`} className="text-section">
            {tw(`groups.${g.group}` as 'groups.orders')}
          </h2>
          {g.events.map((e) => (
            <article
              key={e.anchor}
              id={e.anchor}
              aria-labelledby={`${e.anchor}-title`}
              className="flex flex-col gap-3 rounded-card border border-line bg-surface-solid p-4"
            >
              <h3 id={`${e.anchor}-title`} className="flex flex-wrap items-baseline gap-2">
                <code dir="ltr" className="font-mono text-body font-medium">
                  {e.type}
                </code>
                <span className="rounded-pill bg-surface-2 px-2 font-mono text-caption">v{e.version}</span>
              </h3>
              <p lang="en" className="text-body font-medium">
                {e.summary}
              </p>
              <div lang="en" dir="ltr">
                <Markdown source={e.description} />
              </div>
              <section
                aria-label={t('events.fieldsOf', { type: e.type })}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
                tabIndex={0}
                className="overflow-x-auto"
              >
                <table className="w-full text-start text-caption">
                  <caption className="pb-1 text-start font-medium">{t('events.data')}</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="py-1 pe-3 text-start font-medium">
                        {t('events.field')}
                      </th>
                      <th scope="col" className="py-1 pe-3 text-start font-medium">
                        {t('events.type')}
                      </th>
                      <th scope="col" className="py-1 text-start font-medium">
                        {t('events.required')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.fields.map((f) => (
                      <tr key={f.name} className="border-b border-line">
                        <td dir="ltr" className="py-1 pe-3 font-mono">
                          {f.name}
                        </td>
                        <td className="py-1 pe-3 font-mono">{f.type}</td>
                        <td className="py-1">{f.required ? t('events.yes') : t('events.no')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <CodeBlock title={t('events.example', { type: e.type })} code={e.example} />
            </article>
          ))}
        </section>
      ))}
    </>
  );
}
