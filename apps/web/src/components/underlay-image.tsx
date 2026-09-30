'use client';

import type { Underlay } from '@yayatoh/floorplan';
import { useEffect, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';

/** A browser image for a URL (null until it has loaded). */
export function useImage(url: string | null | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    const el = new window.Image();
    el.onload = () => setImg(el);
    el.src = url;
    return () => {
      el.onload = null;
    };
  }, [url]);
  return img;
}

/**
 * The organizer's floor plan image under the plan (M1.7g), at its place, scale and opacity. It
 * never takes clicks (the plan's rows and tables stay on top).
 */
export function UnderlayImage({ underlay, opacity }: { underlay: Underlay; opacity?: number }) {
  const img = useImage(underlay.url);
  if (!img) return null;
  return (
    <KonvaImage
      image={img}
      x={underlay.x}
      y={underlay.y}
      width={underlay.width}
      height={underlay.height}
      opacity={opacity ?? underlay.opacity}
      listening={false}
    />
  );
}
