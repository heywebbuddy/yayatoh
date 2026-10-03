import { PROFILE_KEYS } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { Breadcrumb, buttonClass, Card, EmptyState, PageHeader, Stepper } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewTemplateForm } from '@/components/template-builder.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { createTemplateAction } from '../actions.ts';

/** U6: a new template from scratch. Step 1 of 5: the kind of event and its defaults. */
export default async function NewTemplatePage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const breadcrumb = (
    <Breadcrumb
      label={t('templateBuilder.breadcrumb')}
      link={Link}
      items={[
        { label: t('templates.title'), href: `/o/${org}/templates` },
        { label: t('templateBuilder.newTitle') },
      ]}
    />
  );
  if (!roleCan(data.role, 'events:write'))
    return (
      <>
        <PageHeader breadcrumb={breadcrumb} title={t('templateBuilder.newTitle')} />
        <EmptyState
          title={t('copy.noAccessTitle')}
          description={t('copy.noAccessDescription')}
          action={
            <Link href={`/o/${org}/templates`} className={buttonClass('secondary', 'md')}>
              {t('templates.title')}
            </Link>
          }
        />
      </>
    );
  // The "other" profile reads best last: the specific kinds first.
  const profiles = [...PROFILE_KEYS.filter((p) => p !== 'other'), 'other' as const].map((key) => ({
    key,
    label: t(`profiles.${key}`),
  }));
  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('templateBuilder.newTitle')}
        description={t('templateBuilder.newDescription')}
      />
      <Stepper
        label={t('templateBuilder.steps')}
        steps={(['profile', 'tickets', 'sections', 'content', 'checklist'] as const).map((k) => ({
          label: t(`templateBuilder.step.${k}`),
          state: k === 'profile' ? 'current' : 'todo',
        }))}
      />
      <Card size="panel">
        <NewTemplateForm
          action={createTemplateAction.bind(null, org)}
          profiles={profiles}
          defaults={{ timezone: data.org.timezone, currency: data.org.currency }}
        />
      </Card>
    </>
  );
}
