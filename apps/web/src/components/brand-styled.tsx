'use client';

import type { AnchorHTMLAttributes, HTMLAttributes } from 'react';
import { useCssomStyle } from '@/lib/cssom-style.ts';

type Brand = { readonly background: string; readonly text: string } | null;
const colours = (brand: Brand) => (brand ? { background: brand.background, color: brand.text } : null);

/**
 * Server pages that paint an organizer's brand colour (the strict CSP, M1.14a, refuses `style`
 * attributes in server-rendered HTML): the colour is applied through the CSSOM after hydration.
 */
export function BrandSection({ brand, ...props }: HTMLAttributes<HTMLElement> & { brand: Brand }) {
  const ref = useCssomStyle<HTMLElement>(colours(brand));
  return <section ref={ref} {...props} />;
}

export function BrandLink({ brand, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { brand: Brand }) {
  const ref = useCssomStyle<HTMLAnchorElement>(colours(brand));
  return <a ref={ref} {...props} />;
}
