import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { apiReference } from '@/server/developer-docs.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'developers' });
  return { title: t('reference.title') };
}

/**
 * The API reference, generated from the `/v1` OpenAPI document (every operation by tag: method,
 * path, parameters, body and responses). The interactive console (Scalar) is linked for trying calls.
 */
export default async function ReferencePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('developers.reference');
  const tags = apiReference();
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <p className="flex flex-wrap gap-x-5 gap-y-2 text-body">
        <a href="/api/v1/docs" className="underline underline-offset-2">
          {t('interactive')}
        </a>
        <a href="/api/v1/openapi.json" className="underline underline-offset-2">
          {t('download')}
        </a>
      </p>
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label={t('tags')} className="lg:sticky lg:top-4 lg:self-start">
          <ul lang="en" className="flex flex-wrap gap-1 lg:flex-col">
            {tags.map((tag) => (
              <li key={tag.slug}>
                <a
                  href={`#tag-${tag.slug}`}
                  className="inline-flex min-h-8 items-center rounded-pill px-2 text-caption hover:bg-surface-2"
                >
                  {tag.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-10">
          {tags.map((tag) => (
            <section key={tag.slug} aria-labelledby={`tag-${tag.slug}`} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 id={`tag-${tag.slug}`} lang="en" className="text-section capitalize">
                  {tag.name}
                </h2>
                <p lang="en" className="text-body text-ink-2">
                  {tag.description}
                </p>
              </div>
              {tag.operations.map((op) => (
                <article
                  key={op.id}
                  id={op.id}
                  aria-labelledby={`${op.id}-title`}
                  className="flex flex-col gap-3 rounded-card border border-line bg-surface-solid p-4"
                >
                  <h3 id={`${op.id}-title`} className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded-pill bg-surface-2 px-2 font-mono text-caption font-medium">
                      {op.method}
                    </span>
                    <code dir="ltr" className="break-all font-mono text-body">
                      {op.path}
                    </code>
                  </h3>
                  <p lang="en" className="text-body font-medium">
                    {op.summary}
                  </p>
                  {op.description ? (
                    <div lang="en" dir="ltr">
                      <Markdown source={op.description} />
                    </div>
                  ) : null}
                  {op.auth.length > 0 ? (
                    <p className="text-caption text-ink-2">
                      {t('auth')}: <span className="font-mono">{op.auth.join(', ')}</span>
                    </p>
                  ) : null}
                  {op.parameters.length > 0 ? (
                    <section
                      aria-label={t('parametersOf', { operation: op.id })}
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
                      tabIndex={0}
                      className="overflow-x-auto"
                    >
                      <table className="w-full text-start text-caption">
                        <caption className="pb-1 text-start font-medium">{t('parameters')}</caption>
                        <thead>
                          <tr className="border-b border-line">
                            <th scope="col" className="py-1 pe-3 text-start font-medium">
                              {t('name')}
                            </th>
                            <th scope="col" className="py-1 pe-3 text-start font-medium">
                              {t('in')}
                            </th>
                            <th scope="col" className="py-1 pe-3 text-start font-medium">
                              {t('type')}
                            </th>
                            <th scope="col" className="py-1 text-start font-medium">
                              {t('description')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {op.parameters.map((p) => (
                            <tr key={`${p.in}:${p.name}`} className="border-b border-line align-top">
                              <td className="py-1 pe-3 font-mono">
                                {p.name}
                                {p.required ? <span className="text-ink-2"> *</span> : null}
                              </td>
                              <td className="py-1 pe-3">{p.in}</td>
                              <td className="py-1 pe-3 font-mono">{p.type}</td>
                              <td lang="en" className="py-1">
                                {p.description}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ) : null}
                  {op.requestBody ? (
                    <p className="text-caption">
                      {t('requestBody')}: <code className="font-mono">{op.requestBody}</code>
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <p className="text-caption font-medium">{t('responses')}</p>
                    <ul className="flex flex-col gap-0.5 text-caption">
                      {op.responses.map((r) => (
                        <li key={r.status}>
                          <span className="font-mono">{r.status}</span> <span lang="en">{r.description}</span>
                          {r.schema ? <code className="ms-1 font-mono text-ink-2">{r.schema}</code> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
