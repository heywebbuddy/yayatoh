/** Renders a self-contained HTML document to a tagged PDF (ADR 0017). */
export interface PdfRenderer {
  render(input: { html: string; filename?: string }): Promise<Uint8Array>;
  /** Concatenate PDFs in order (batch jobs render in chunks, M5.5a). */
  merge?(pdfs: readonly Uint8Array[]): Promise<Uint8Array>;
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
  const mergeEndpoint = new URL('/forms/pdfengines/merge', opts.url).toString();
  return {
    async merge(pdfs) {
      const form = new FormData();
      // Gotenberg merges in file-name order: zero-padded sequence numbers keep ours.
      for (const [i, pdf] of pdfs.entries())
        form.append(
          'files',
          new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
          `${String(i).padStart(6, '0')}.pdf`,
        );
      const res = await doFetch(mergeEndpoint, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      if (!res.ok) throw new Error(`gotenberg merge: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async render({ html }) {
      // One retry on a timeout or 5xx: a cold Chromium (after a Gotenberg restart) can be slow.
      for (let attempt = 1; ; attempt++) {
        const form = new FormData();
        form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
        form.append('generateTaggedPdf', 'true');
        form.append('preferCssPageSize', 'true');
        form.append('printBackground', 'true');
        // Chromium must not fetch anything: the template is self-contained.
        form.append('skipNetworkIdleEvent', 'true');
        try {
          const res = await doFetch(endpoint, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
          });
          if (res.ok) return new Uint8Array(await res.arrayBuffer());
          const err = new Error(`gotenberg: ${res.status} ${(await res.text()).slice(0, 200)}`);
          if (res.status < 500 || attempt >= 2) throw err;
        } catch (err) {
          const retryable =
            err instanceof Error &&
            (err.name === 'TimeoutError' ||
              err.name === 'AbortError' ||
              /gotenberg: 5\d\d/.test(err.message));
          if (!retryable || attempt >= 2) throw err;
        }
      }
    },
  };
}
