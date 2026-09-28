import { LOCALES } from '@yayatoh/contracts';
import { executeQuery } from '@yayatoh/kernel';
import {
  allowedPlaceholders,
  EMAIL_KINDS,
  EMAIL_MESSAGES,
  emailLocale,
  type MessageKind,
  templateOverridesQuery,
} from '@yayatoh/notifications';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TemplateEditor } from '@/components/template-editor.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { previewTemplateAction, saveTemplateAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('emailTemplates');
  return { title: t('title') };
}

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/**
 * Email templates (M1.10d): the org's own subject and opening paragraph per message kind and
 * language, over the platform's copy. Every member can read them (and preview); only roles with
 * `org:update` can change them. Kind and language are in the URL (no-JS form, survives reload).
 */
export default async function EmailTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ kind?: string; lang?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('emailTemplates');
  const tk = await getTranslations('notifications.kinds');
  const kind: MessageKind = (EMAIL_KINDS as readonly string[]).includes(sp.kind ?? '')
    ? (sp.kind as MessageKind)
    : (EMAIL_KINDS[0] as MessageKind);
  const lang = emailLocale(sp.lang ?? data.org.defaultLocale);
  const overrides = await executeQuery(templateOverridesQuery, {}, data.ctx, ports);
  const current = overrides.find((o) => o.kind === kind && o.locale === lang);
  const copy = (EMAIL_MESSAGES[lang].kinds as Record<string, { subject: string; intro: string }>)[kind];
  const canEdit = roleCan(data.role, 'org:update');
  const langName = (l: string) => new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l;
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label={t('chooseLabel')}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="template-kind" className="text-caption text-zinc-600">
            {t('kind')}
          </label>
          <select id="template-kind" name="kind" defaultValue={kind} className={field}>
            {EMAIL_KINDS.map((k) => (
              <option key={k} value={k}>
                {tk(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="template-lang" className="text-caption text-zinc-600">
            {t('language')}
          </label>
          <select id="template-lang" name="lang" defaultValue={lang} className={field}>
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          {t('open')}
        </button>
      </form>

      <Card className="flex flex-col gap-4">
        <h2 className="text-section">{t('editing', { kind: tk(kind), language: langName(lang) })}</h2>
        <TemplateEditor
          key={`${kind}:${lang}`}
          action={saveTemplateAction.bind(null, org, kind, lang)}
          preview={previewTemplateAction.bind(null, org, kind, lang)}
          initial={{ subject: current?.subject ?? '', intro: current?.intro ?? '' }}
          defaults={{ subject: copy?.subject ?? '', intro: copy?.intro ?? '' }}
          placeholders={[...allowedPlaceholders(kind)].sort()}
          canEdit={canEdit}
        />
      </Card>

      <section aria-labelledby="overrides-heading" className="flex flex-col gap-3">
        <h2 id="overrides-heading" className="text-section">
          {t('customized')}
        </h2>
        {overrides.length === 0 ? (
          <EmptyState title={t('noneTitle')} description={t('noneDescription')} />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-start text-body">
              <thead>
                <tr className="border-b border-zinc-200 text-caption text-zinc-600">
                  <th scope="col" className="px-4 py-2 text-start font-normal">
                    {t('kind')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-normal">
                    {t('language')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-normal">
                    {t('changed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={`${o.kind}:${o.locale}`} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/o/${org}/emails?kind=${encodeURIComponent(o.kind)}&lang=${o.locale}`}
                        className="underline"
                      >
                        {tk(o.kind)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{langName(o.locale)}</td>
                    <td className="px-4 py-2">{dateFmt.format(o.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </>
  );
}
