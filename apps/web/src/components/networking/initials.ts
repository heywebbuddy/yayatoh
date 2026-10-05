/** "Ana María Ruiz" → "AM" (an avatar's letters). */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase() ?? '')
    .join('');
