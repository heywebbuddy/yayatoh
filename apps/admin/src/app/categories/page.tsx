import { Alert, Button, Card, IconButton, PageHeader, StatusPill } from '@yayatoh/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { listPlatformCategories } from '@/server/platform-categories.ts';
import { requireStaff } from '@/server/staff.ts';
import { savePlatformCategoriesAction } from './actions.ts';

/**
 * U8 (UX-2): the platform's default event categories. Every new organization's list starts as
 * the ticked ones, in this order; organizations rename, hide and add their own afterwards (and
 * keep their list when this one changes). Admins only; every view and save is in the access log.
 */
export default async function PlatformCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; focus?: string }>;
}) {
  const staff = await requireStaff('categories');
  const sp = await searchParams;
  const t = await getTranslations('platformCategories');
  const rows = await listPlatformCategories(staff.actor);
  const included = rows.filter((r) => r.inDefaults);
  const done = sp.done === 'saved' || sp.done === 'moved' ? sp.done : null;
  const label = (key: string) => t(`labels.${key}` as 'labels.other');
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <div aria-live="polite">
        {done ? <Alert tone="info" title={t(`done.${done}`)} /> : null}
        {sp.error === 'empty' ? <Alert title={t('error.empty')} /> : null}
      </div>
      <Card className="flex flex-col gap-4">
        <h2 className="text-section">{t('listTitle', { count: included.length })}</h2>
        <p className="text-body text-ink-2">{t('explain')}</p>
        <form action={savePlatformCategoriesAction} className="flex flex-col gap-4">
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => {
              const at = included.findIndex((x) => x.key === r.key);
              return (
                <li
                  key={r.key}
                  className="flex flex-wrap items-center gap-3 rounded-tile border border-line px-3 py-2"
                >
                  <input type="hidden" name="key" value={r.key} />
                  <label className="flex min-h-6 grow items-center gap-2.5 text-body">
                    <input
                      type="checkbox"
                      name="include"
                      value={r.key}
                      defaultChecked={r.inDefaults}
                      className="size-5 shrink-0 accent-primary"
                    />
                    <span className="font-semibold">{label(r.key)}</span>
                    {r.inDefaults ? null : <StatusPill tone="neutral" label={t('notInDefaults')} />}
                  </label>
                  {r.inDefaults ? (
                    <span className="flex gap-2">
                      <IconButton
                        type="submit"
                        name="move"
                        value={`up:${r.key}`}
                        size="sm"
                        label={t('moveUp', { name: label(r.key) })}
                        icon={<ArrowUp aria-hidden="true" className="size-4" />}
                        disabled={at <= 0}
                        autoFocus={sp.focus === `up:${r.key}`}
                      />
                      <IconButton
                        type="submit"
                        name="move"
                        value={`down:${r.key}`}
                        size="sm"
                        label={t('moveDown', { name: label(r.key) })}
                        icon={<ArrowDown aria-hidden="true" className="size-4" />}
                        disabled={at < 0 || at >= included.length - 1}
                        autoFocus={sp.focus === `down:${r.key}`}
                      />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <Button type="submit" className="self-start">
            {t('save')}
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
