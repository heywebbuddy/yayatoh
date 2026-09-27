'use client';

import { useEffect } from 'react';

/**
 * Tells the embedding page (widget.js) how tall the widget is, so the iframe fits its content
 * without a scrollbar. Messages go only to the embedding origin, and only when it is one the
 * organizer allowed (the CSP frame-ancestors header already refuses every other origin).
 */
export function EmbedResizer({ slug, allowedOrigins }: { slug: string; allowedOrigins: readonly string[] }) {
  useEffect(() => {
    if (window.parent === window) return;
    const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    let parent = ancestors && ancestors.length > 0 ? ancestors[0] : null;
    if (!parent && document.referrer) {
      try {
        parent = new URL(document.referrer).origin;
      } catch {
        parent = null;
      }
    }
    if (!parent || !allowedOrigins.includes(parent)) return;
    const target = parent;
    const post = () =>
      window.parent.postMessage(
        { type: 'yayatoh:resize', slug, height: Math.ceil(document.documentElement.scrollHeight) },
        target,
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [slug, allowedOrigins]);
  return null;
}
