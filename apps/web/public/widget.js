/*
 * Yayatoh ticket widget loader (M1.11c). Organizers paste:
 *   <iframe src="https://yayatoh.com/embed/{event}" title="…" data-yayatoh-widget …></iframe>
 *   <script src="https://yayatoh.com/widget.js" async></script>
 * It resizes each widget iframe to its content. It trusts messages only from its own origin
 * and only for an iframe on this page that sent them.
 */
(() => {
  const script = document.currentScript;
  const origin = script ? new URL(script.src, location.href).origin : null;
  if (!origin || window.__yayatohWidget) return;
  window.__yayatohWidget = true;
  window.addEventListener('message', (event) => {
    if (event.origin !== origin) return;
    const data = event.data;
    if (data?.type !== 'yayatoh:resize' || typeof data.height !== 'number') return;
    for (const frame of document.querySelectorAll('iframe[data-yayatoh-widget]')) {
      if (frame.contentWindow === event.source) {
        frame.style.height = `${Math.min(Math.max(data.height, 120), 4000)}px`;
      }
    }
  });
})();
