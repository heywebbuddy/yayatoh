import type { ReactNode } from 'react';
import { ShowcaseFooter } from '@/components/showcase/footer.tsx';
import { ShowcaseTopBar } from '@/components/showcase/top-bar.tsx';

/**
 * The public site's header and footer. They are the showcase top bar and footer, so every page that
 * already composes `SiteHeader` / `SiteFooter` (venues, series, organizers, help, legal, pricing…)
 * takes the new look from one place. `name` is a tenant site's own name in place of the wordmark.
 */
export async function SiteHeader({ name }: { name?: string; browse?: boolean }) {
  return <ShowcaseTopBar {...(name ? { name } : {})} />;
}

export async function SiteFooter({ children }: { children?: ReactNode }) {
  return <ShowcaseFooter>{children}</ShowcaseFooter>;
}
