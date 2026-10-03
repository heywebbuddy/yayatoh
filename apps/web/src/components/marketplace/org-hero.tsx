import { publicMedia } from '@yayatoh/media';
import { brandPalette } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { BrandSection } from '@/components/brand-styled.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';

/**
 * An organizer's banner in its brand kit colour (text colour chosen for contrast), else ink, with
 * the org's logo (M1.4e) on a white tile so any logo stays legible on any brand colour.
 */
export async function OrgHero({
  orgId,
  eyebrow,
  name,
  brandColor,
  children,
}: {
  orgId: string;
  eyebrow: string;
  name: string;
  brandColor: string | null;
  children?: ReactNode;
}) {
  const brand = brandColor ? brandPalette(brandColor) : null;
  const logo = (await publicMedia('org', orgId))[0] ?? null;
  return (
    <BrandSection
      aria-labelledby="org-heading"
      className="mx-3 flex flex-col gap-3 overflow-hidden rounded-[32px] bg-hero px-6 py-12 text-white elevation-card sm:mx-5 md:px-12"
      brand={brand}
    >
      {logo ? (
        <div
          data-testid="org-logo"
          className="flex size-20 items-center justify-center rounded-tile bg-white p-2"
        >
          <MediaPicture image={logo} sizes="80px" eager className="max-h-16 w-auto object-contain" />
        </div>
      ) : null}
      <p className="text-label uppercase opacity-80">{eyebrow}</p>
      <h1
        id="org-heading"
        className="text-[40px] leading-none font-extrabold tracking-[-0.04em] md:text-[56px]"
      >
        {name}
      </h1>
      {children}
    </BrandSection>
  );
}
