import { Button, Card, PageHeader } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { getPost } from '@/server/platform-content.ts';
import { requireStaff } from '@/server/staff.ts';
import { deletePostAction, savePostAction, unpublishPostAction } from '../../actions.ts';
import { ContentTabs } from '../../tabs.tsx';

/** Write or edit one platform blog post (`new` starts a draft). */
export default async function PostEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const post = id === 'new' ? null : await getPost(staff.actor, id);
  if (id !== 'new' && !post) notFound();
  return (
    <Shell staff={staff}>
      <PageHeader
        title={post ? post.title : t('blog.new')}
        description={
          post?.status === 'published'
            ? t('blog.liveAt', { path: `/blogs/${post.slug}` })
            : t('blog.draftHint')
        }
        actions={
          <Link href="/content/blog" className="text-body underline underline-offset-4">
            {t('blog.back')}
          </Link>
        }
      />
      <ContentTabs active="blog" done={sp.done} error={sp.error} />
      <Card size="panel">
        <form action={savePostAction} encType="multipart/form-data" className="flex flex-col gap-4">
          {post ? <input type="hidden" name="id" value={post.id} /> : null}
          {post?.coverAssetId ? <input type="hidden" name="coverAssetId" value={post.coverAssetId} /> : null}
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('blog.fields.title')}
            <input
              name="title"
              required
              maxLength={160}
              defaultValue={post?.title}
              className="field w-full"
            />
          </label>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('blog.fields.slug')}
            <input
              name="slug"
              maxLength={80}
              pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
              defaultValue={post?.slug}
              className="field w-full"
            />
            <span className="text-caption font-normal text-ink-2">{t('blog.fields.slugHint')}</span>
          </label>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('blog.fields.excerpt')}
            <textarea
              name="excerpt"
              rows={2}
              maxLength={400}
              defaultValue={post?.excerpt}
              className="field w-full"
            />
          </label>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('blog.fields.body')}
            <textarea
              name="body"
              rows={16}
              maxLength={50000}
              defaultValue={post?.body}
              className="field w-full font-mono"
            />
            <span className="text-caption font-normal text-ink-2">{t('blog.fields.bodyHint')}</span>
          </label>
          <div className="flex flex-col gap-2">
            <label htmlFor="cover" className="text-body font-semibold">
              {t('blog.fields.cover')}
            </label>
            {post?.coverAssetId ? (
              <div className="flex flex-wrap items-center gap-3">
                <img
                  src={`/api/asset/${post.coverAssetId}`}
                  alt={t('blog.fields.coverAlt')}
                  className="h-24 w-auto rounded-control border border-line"
                />
                <label className="flex items-center gap-2 text-body">
                  <input type="checkbox" name="remove_cover" value="1" className="size-5 accent-primary" />
                  {t('blog.fields.removeCover')}
                </label>
              </div>
            ) : null}
            <input id="cover" name="cover" type="file" accept="image/jpeg,image/png,image/webp" />
            <span className="text-caption text-ink-2">{t('blog.fields.coverHint')}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('blog.fields.seoTitle')}
              <input
                name="seoTitle"
                maxLength={70}
                defaultValue={post?.seoTitle ?? ''}
                className="field w-full"
              />
            </label>
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('blog.fields.authorName')}
              <input
                name="authorName"
                maxLength={120}
                defaultValue={post?.authorName ?? ''}
                className="field w-full"
              />
            </label>
          </div>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('blog.fields.seoDescription')}
            <textarea
              name="seoDescription"
              rows={2}
              maxLength={200}
              defaultValue={post?.seoDescription ?? ''}
              className="field w-full"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" name="intent" value="publish">
              {post?.status === 'published' ? t('blog.saveLive') : t('blog.publish')}
            </Button>
            <Button type="submit" name="intent" value="draft" variant="secondary">
              {t('blog.saveDraft')}
            </Button>
          </div>
        </form>
      </Card>
      {post ? (
        <Card className="flex flex-wrap items-center gap-3">
          {post.status === 'published' ? (
            <form action={unpublishPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="title" value={post.title} />
              <input type="hidden" name="slug" value={post.slug} />
              <input type="hidden" name="excerpt" value={post.excerpt} />
              <input type="hidden" name="body" value={post.body} />
              <input type="hidden" name="coverAssetId" value={post.coverAssetId ?? ''} />
              <input type="hidden" name="seoTitle" value={post.seoTitle ?? ''} />
              <input type="hidden" name="seoDescription" value={post.seoDescription ?? ''} />
              <input type="hidden" name="authorName" value={post.authorName ?? ''} />
              <Button type="submit" variant="secondary">
                {t('blog.unpublish')}
              </Button>
            </form>
          ) : null}
          <form action={deletePostAction}>
            <input type="hidden" name="id" value={post.id} />
            <Button type="submit" variant="danger">
              {t('blog.delete')}
            </Button>
          </form>
        </Card>
      ) : null}
    </Shell>
  );
}
