'use client';

import { Breadcrumb, type Crumb } from '@yayatoh/ui';
import { Link, usePathname } from '@/i18n/navigation.ts';

export interface TrailSection {
  readonly key: string;
  readonly label: string;
  readonly items: readonly { readonly key: string; readonly label: string; readonly href: string }[];
}

/**
 * U2 (principle 8, consistent page anatomy): the breadcrumb above every org page's header,
 * derived from the grouped navigation: organization › section › page, the section left out when it
 * is the page itself (Events). The page's own title follows in its PageHeader; deeper pages
 * (a venue, a campaign) link back to their list.
 */
export function OrgTrail({
  label,
  org,
  sections,
}: {
  label: string;
  org: { readonly label: string; readonly href: string };
  sections: readonly TrailSection[];
}) {
  const pathname = usePathname();
  if (pathname === org.href) return null;
  for (const s of sections)
    for (const item of s.items) {
      if (item.href === org.href) continue;
      const exact = pathname === item.href;
      if (!exact && !pathname.startsWith(`${item.href}/`)) continue;
      const page: Crumb = exact ? { label: item.label } : { label: item.label, href: item.href };
      // The Events section's own Events page is said once: organization › Events.
      const items: Crumb[] =
        s.key === item.key
          ? [{ label: org.label, href: org.href }, page]
          : [{ label: org.label, href: org.href }, { label: s.label }, page];
      return (
        <div className="-mb-2" data-testid="org-trail">
          <Breadcrumb label={label} items={items} link={Link} />
        </div>
      );
    }
  return null;
}
