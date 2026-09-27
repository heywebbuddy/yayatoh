import type { ListingDto } from '@yayatoh/marketplace';
import { EmptyState } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { ListingCard } from './listing-card.tsx';

export function ListingGrid({
  items,
  locale,
  label,
  empty,
  organizerHref,
}: {
  items: readonly ListingDto[];
  locale: string;
  label: string;
  empty: { title: string; description: string; action?: ReactNode };
  organizerHref: ((orgSlug: string) => string) | null;
}) {
  if (items.length === 0)
    return <EmptyState title={empty.title} description={empty.description} action={empty.action} />;
  return (
    <ul aria-label={label} className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
      {items.map((l) => (
        <li key={l.slug}>
          <ListingCard
            listing={l}
            locale={locale}
            organizerHref={organizerHref ? organizerHref(l.orgSlug) : null}
          />
        </li>
      ))}
    </ul>
  );
}
