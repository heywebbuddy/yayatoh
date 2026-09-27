/** Renders a self-contained HTML document to a tagged PDF (ADR 0017). */
export interface PdfRenderer {
  render(input: { html: string; filename?: string }): Promise<Uint8Array>;
}

/**
 * Gotenberg adapter (Chromium). The service is private (Fly internal network, CI service
 * container, docker-compose locally); the HTML must not reference remote assets.
 */
export function gotenbergRenderer(opts: {
  url: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): PdfRenderer {
  const doFetch = opts.fetch ?? fetch;
  const endpoint = new URL('/forms/chromium/convert/html', opts.url).toString();
  return {
    async render({ html }) {
      const form = new FormData();
      form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
      form.append('generateTaggedPdf', 'true');
      form.append('preferCssPageSize', 'true');
      form.append('printBackground', 'true');
      // Chromium must not fetch anything: the template is self-contained.
      form.append('skipNetworkIdleEvent', 'true');
      const res = await doFetch(endpoint, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      if (!res.ok) throw new Error(`gotenberg: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
