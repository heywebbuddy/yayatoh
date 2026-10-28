import type { ReactNode } from 'react';
import { ShowcaseFooter } from './footer.tsx';
import { ShowcaseTopBar } from './top-bar.tsx';

/**
 * The public marketplace page frame: the showcase surface (near-black canvas, red accents), the
 * floating top bar, the page, and the footer. Anything inside reads the showcase colour roles.
 */
export async function ShowcaseShell({
  children,
  footerTop,
  name,
  width = 'max-w-7xl',
}: {
  children: ReactNode;
  footerTop?: ReactNode;
  name?: string;
  width?: string;
}) {
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page">
      <ShowcaseTopBar {...(name ? { name } : {})} />
      <main
        id="main"
        className={`mx-auto flex w-full ${width} flex-col gap-16 px-4 pt-5 pb-4 md:px-6 md:pt-6`}
      >
        {children}
      </main>
      <ShowcaseFooter>{footerTop}</ShowcaseFooter>
    </div>
  );
}
