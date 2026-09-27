const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The ticket widget snippet an organizer pastes (M1.11c): a lazy iframe marked for the loader,
 * and the loader that resizes it (public/widget.js).
 */
export function widgetSnippet(origin: string, slug: string, title: string): string {
  return [
    `<iframe src="${origin}/embed/${encodeURIComponent(slug)}" title="${attr(title)}" data-yayatoh-widget loading="lazy" style="width:100%;border:0;min-height:320px"></iframe>`,
    `<script src="${origin}/widget.js" async></script>`,
  ].join('\n');
}
