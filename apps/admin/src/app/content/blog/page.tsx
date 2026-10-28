import { buttonClass, Card, EmptyState, PageHeader, StatusPill } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { listPosts } from '@/server/platform-content.ts';
import { requireStaff } from '@/server/staff.ts';
import { ContentTabs } from '../tabs.tsx';

/** Platform blog posts: the ones on yayatoh.com/blogs and in the home "Latest from the blog". */
export default async function BlogAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const posts = await listPosts(staff.actor);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Shell staff={staff}>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/content/blog/new" className={buttonClass('primary')}>
            {t('blog.new')}
          </Link>
        }
      />
      <ContentTabs active="blog" done={sp.done} error={sp.error} />
      {posts.length === 0 ? (
        <EmptyState title={t('blog.emptyTitle')} description={t('blog.emptyDescription')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {posts.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/content/blog/${p.id}`}
                    className="text-card font-bold underline-offset-4 hover:underline"
                  >
                    {p.title}
                  </Link>
                  <span className="text-caption text-ink-2">
                    /blogs/{p.slug} · {t('blog.updated', { when: when.format(p.updatedAt) })}
                  </span>
                </div>
                <StatusPill
                  tone={p.status === 'published' ? 'success' : 'neutral'}
                  label={t(`blog.status.${p.status}`)}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
