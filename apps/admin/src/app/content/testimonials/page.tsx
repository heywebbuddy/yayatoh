import { Button, Card, EmptyState, PageHeader, Select, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { listTestimonials, type TestimonialRow } from '@/server/platform-content.ts';
import { requireStaff } from '@/server/staff.ts';
import { deleteTestimonialAction, saveTestimonialAction } from '../actions.ts';
import { ContentTabs } from '../tabs.tsx';

function Fields({ row, t }: { row?: TestimonialRow; t: Awaited<ReturnType<typeof getTranslations>> }) {
  return (
    <>
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      {row?.photoAssetId ? <input type="hidden" name="photoAssetId" value={row.photoAssetId} /> : null}
      <label className="flex flex-col gap-2 text-body font-semibold">
        {t('testimonials.quote')}
        <textarea
          name="quote"
          required
          rows={3}
          maxLength={600}
          defaultValue={row?.quote}
          className="field w-full"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-body font-semibold">
          {t('testimonials.name')}
          <input name="name" required maxLength={120} defaultValue={row?.name} className="field w-full" />
        </label>
        <label className="flex flex-col gap-2 text-body font-semibold">
          {t('testimonials.role')}
          <input name="role" maxLength={160} defaultValue={row?.role ?? ''} className="field w-full" />
        </label>
        <label className="flex flex-col gap-2 text-body font-semibold">
          {t('testimonials.rating')}
          <Select
            name="rating"
            defaultValue={row?.rating ? String(row.rating) : ''}
            options={[
              { value: '', label: t('testimonials.noRating'), text: t('testimonials.noRating') },
              ...[5, 4, 3, 2, 1].map((n) => ({
                value: String(n),
                label: '★'.repeat(n),
                text: '★'.repeat(n),
              })),
            ]}
          />
        </label>
        <label className="flex flex-col gap-2 text-body font-semibold">
          {t('testimonials.position')}
          <input
            name="position"
            type="number"
            min={0}
            max={9999}
            defaultValue={row?.position ?? 0}
            className="field w-full"
          />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-body font-semibold">{t('testimonials.photo')}</span>
        {row?.photoAssetId ? (
          <div className="flex items-center gap-3">
            <img
              src={`/api/asset/${row.photoAssetId}`}
              alt=""
              className="size-12 rounded-full object-cover"
            />
            <label className="flex items-center gap-2 text-body font-normal">
              <input type="checkbox" name="remove_photo" value="1" className="size-5 accent-primary" />
              {t('testimonials.removePhoto')}
            </label>
          </div>
        ) : null}
        <input
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={t('testimonials.photo')}
        />
      </div>
      <label className="flex items-center gap-2 text-body">
        <input
          type="checkbox"
          name="published"
          value="1"
          defaultChecked={row?.published ?? true}
          className="size-5 accent-primary"
        />
        {t('testimonials.published')}
      </label>
    </>
  );
}

/** Testimonials for the home page (published ones, ordered by position). */
export default async function TestimonialsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const rows = await listTestimonials(staff.actor);
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <ContentTabs active="testimonials" done={sp.done} error={sp.error} />
      <Card size="panel" className="flex flex-col gap-4">
        <h2 className="text-section">{t('testimonials.add')}</h2>
        <form action={saveTestimonialAction} encType="multipart/form-data" className="flex flex-col gap-4">
          <Fields t={t} />
          <Button type="submit" className="self-start">
            {t('testimonials.save')}
          </Button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title={t('testimonials.emptyTitle')} description={t('testimonials.emptyDescription')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-card">{r.name}</strong>
                  <StatusPill
                    tone={r.published ? 'success' : 'neutral'}
                    label={t(r.published ? 'testimonials.live' : 'testimonials.hidden')}
                  />
                </div>
                <details>
                  <summary className="min-h-10 cursor-pointer content-center font-bold">
                    {t('testimonials.edit')}
                  </summary>
                  <form
                    action={saveTestimonialAction}
                    encType="multipart/form-data"
                    className="flex flex-col gap-4 pt-3"
                  >
                    <Fields row={r} t={t} />
                    <Button type="submit" className="self-start">
                      {t('testimonials.save')}
                    </Button>
                  </form>
                </details>
                <form action={deleteTestimonialAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" variant="danger" size="sm">
                    {t('testimonials.delete')}
                  </Button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
