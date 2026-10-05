/** "1.2 MB", "512 KB" in the reader's locale (binary units, as quotas are). */
export function formatBytes(bytes: number, locale: string): string {
  const units = [
    ['gigabyte', 1024 ** 3],
    ['megabyte', 1024 ** 2],
    ['kilobyte', 1024],
  ] as const;
  for (const [unit, size] of units)
    if (bytes >= size)
      return new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(
        bytes / size,
      );
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'byte', maximumFractionDigits: 0 }).format(
    bytes,
  );
}

/** Whole percent of a quota, never above 100 (and 1 % for any use at all). */
export function percentOf(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 100 : 0;
  if (used <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((used / limit) * 100)));
}
