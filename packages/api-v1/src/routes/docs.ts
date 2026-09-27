import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';

/**
 * Where Scalar's standalone bundle lives. Resolved from this package, or (inside a bundled host
 * such as the Next server) through the host's `node_modules/@yayatoh/api-v1` link.
 */
function bundlePath(): string {
  const bases = [
    import.meta.url,
    pathToFileURL(join(process.cwd(), 'node_modules/@yayatoh/api-v1/package.json')).href,
  ];
  for (const base of bases) {
    try {
      const entry = createRequire(base).resolve('@scalar/api-reference');
      return join(dirname(entry), 'browser/standalone.js');
    } catch {}
  }
  throw new Error('@scalar/api-reference is not installed');
}

let bundle: Promise<string> | undefined;
/** Scalar's standalone bundle, served from our own origin (no CDN, no third-party script). */
function scalarBundle(): Promise<string> {
  bundle ??= readFile(bundlePath(), 'utf8');
  return bundle;
}

/**
 * The API reference (Scalar) at `{base}/docs`, reading `{base}/openapi.json`. The bundle and its
 * start-up script are served from the same origin; nothing loads from a CDN.
 */
export function docsRoutes(basePath: string) {
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yayatoh API reference</title>
</head>
<body>
<main id="api-reference"></main>
<script src="${basePath}/docs/scalar.js"></script>
<script src="${basePath}/docs/init.js" data-url="${basePath}/openapi.json"></script>
</body>
</html>`;
  // Same-origin, no inline script: the page works under a strict script-src 'self' CSP.
  const init = `(function () {
  var url = document.currentScript.getAttribute('data-url');
  Scalar.createApiReference('#api-reference', {
    url: url,
    withDefaultFonts: false,
    telemetry: false,
    hideClientButton: false,
    showDeveloperTools: 'never',
    agent: { disabled: true },
    mcp: { disabled: true },
    metaData: { title: 'Yayatoh API reference' }
  });
})();
`;
  return new Hono()
    .get('/docs', (c) => {
      // Nothing third-party: Scalar's hosted fonts and AI helpers are blocked as well as off.
      c.header(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      return c.html(page);
    })
    .get('/docs/init.js', (c) =>
      c.body(init, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' }),
    )
    .get('/docs/scalar.js', async (c) =>
      c.body(await scalarBundle(), 200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      }),
    );
}
