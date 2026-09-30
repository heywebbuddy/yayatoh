/**
 * A short, language-neutral name for a browser from its User-Agent ("Chrome · Android"), shown in
 * a person's push device list (M1.10e). Never the endpoint; nothing identifying beyond the kind of
 * browser.
 */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? '';
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /SamsungBrowser\//.test(s)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(s)
          ? 'Firefox'
          : /Chrome\/|CriOS\/|Chromium\//.test(s)
            ? 'Chrome'
            : /Safari\//.test(s)
              ? 'Safari'
              : 'Browser';
  const os = /Android/.test(s)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(s)
      ? 'iOS'
      : /CrOS/.test(s)
        ? 'ChromeOS'
        : /Windows/.test(s)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(s)
            ? 'macOS'
            : /Linux/.test(s)
              ? 'Linux'
              : null;
  return os ? `${browser} · ${os}` : browser;
}
