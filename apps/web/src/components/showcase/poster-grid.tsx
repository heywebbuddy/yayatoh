import type { ListingDto } from '@yayatoh/marketplace';
import { publicCovers } from '@yayatoh/media';
import { EmptyState } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { PosterCard } from './poster-card.tsx';

/** Search results as a wrap of poster cards (the events list); an empty state when there are none. */
export async function PosterGrid({
  items,
  locale,
  label,
  empty,
}: {
  items: readonly ListingDto[];
  locale: string;
  label: string;
  empty: { title: string; description: string; action?: ReactNode };
}) {
  if (items.length === 0)
    return <EmptyState title={empty.title} description={empty.description} action={empty.action} />;
  const covers = await publicCovers(items.map((l) => l.slug));
  return (
    <ul
      aria-label={label}
      className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-8 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {items.map((l) => (
        <li key={l.slug}>
          <PosterCard listing={l} cover={covers.get(l.slug) ?? null} locale={locale} className="w-full" />
        </li>
      ))}
    </ul>
  );
}
