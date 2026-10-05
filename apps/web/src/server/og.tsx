import 'server-only';
import { brandPalette, constant, light } from '@yayatoh/ui';
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * A 1200×630 share image (roadmap §4.4: per-org OG images). Colours come only from design tokens
 * and the org's brand kit (with the contrast-chosen text colour); no raw colours.
 */
export function ogImage(o: {
  eyebrow: string;
  title: string;
  lines: readonly string[];
  footer: string;
  brandColor: string | null;
}): ImageResponse {
  const brand = o.brandColor ? brandPalette(o.brandColor) : null;
  const background = brand?.background ?? light.primary;
  const text = brand?.text ?? constant.white;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background,
        color: text,
      }}
    >
      <div
        style={{ display: 'flex', fontSize: 26, letterSpacing: 4, textTransform: 'uppercase', opacity: 0.8 }}
      >
        {o.eyebrow}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            fontSize: o.title.length > 40 ? 64 : 84,
            lineHeight: 1.02,
            letterSpacing: -2,
          }}
        >
          {o.title}
        </div>
        {o.lines.map((l) => (
          <div key={l} style={{ display: 'flex', fontSize: 32, opacity: 0.85 }}>
            {l}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, letterSpacing: -1 }}>{o.footer}</div>
    </div>,
    { ...OG_SIZE, headers: { 'cache-control': 'public, max-age=3600, s-maxage=3600' } },
  );
}
