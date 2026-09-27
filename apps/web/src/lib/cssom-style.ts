'use client';

import { useLayoutEffect, useRef } from 'react';

type StyleProps = Partial<Record<'background' | 'color' | 'borderColor', string>>;

/**
 * Apply dynamic colours (an organizer's brand) through the CSSOM after hydration instead of a
 * `style` attribute: the strict CSP (M1.14a) refuses style attributes in server-rendered HTML,
 * while script-set styles are allowed. Returns a ref for the element.
 */
export function useCssomStyle<T extends HTMLElement>(style: StyleProps | null | undefined) {
  const ref = useRef<T>(null);
  const key = JSON.stringify(style ?? {});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = (style ?? {}) as StyleProps;
    el.style.background = s.background ?? '';
    el.style.color = s.color ?? '';
    el.style.borderColor = s.borderColor ?? '';
  }, [key]);
  return ref;
}
