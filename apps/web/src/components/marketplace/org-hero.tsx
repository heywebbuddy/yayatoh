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
      className="mx-2 flex flex-col gap-3 rounded-panel bg-black px-6 py-12 text-white md:px-16"
      brand={brand}
    >
      {logo ? (
        <div
          data-testid="org-logo"
          className="flex size-20 items-center justify-center rounded-card bg-surface p-2"
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
