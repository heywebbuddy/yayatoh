/** One CSV field: quoted when needed; formula-like values are neutralised (CSV injection). */
export function csvCell(value: string | number | null | undefined): string {
  let v = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

export const csvRow = (cells: readonly (string | number | null | undefined)[]) =>
  `${cells.map(csvCell).join(',')}\r\n`;
