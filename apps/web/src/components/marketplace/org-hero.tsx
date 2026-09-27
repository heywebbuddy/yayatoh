import { brandPalette } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { BrandSection } from '@/components/brand-styled.tsx';

/** An organizer's banner in its brand kit colour (text colour chosen for contrast), else ink. */
export function OrgHero({
  eyebrow,
  name,
  brandColor,
  children,
}: {
  eyebrow: string;
  name: string;
  brandColor: string | null;
  children?: ReactNode;
}) {
  const brand = brandColor ? brandPalette(brandColor) : null;
  return (
    <BrandSection
      aria-labelledby="org-heading"
      className="mx-2 flex flex-col gap-3 rounded-panel bg-black px-6 py-12 text-white md:px-16"
      brand={brand}
    >
      <p className="font-mono text-label uppercase opacity-80">{eyebrow}</p>
      <h1 id="org-heading" className="text-[40px] leading-none font-light tracking-[-0.04em] md:text-[56px]">
        {name}
      </h1>
      {children}
    </BrandSection>
  );
}
