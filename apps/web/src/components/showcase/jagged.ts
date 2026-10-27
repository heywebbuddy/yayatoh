/**
 * The hero's sound-wave edge: a circle whose rim is a ring of bars of uneven height, as one
 * closed path in the unit square (for `clipPathUnits="objectBoundingBox"`). Deterministic, so the
 * server and the browser draw the same shape.
 */
export function jaggedCirclePath(bars = 120, base = 0.4, amp = 0.09): string {
  const pts: string[] = [];
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    // Two slow waves and a fast one, so the rim looks like an audio trace rather than a gear.
    const wave =
      Math.abs(Math.sin(i * 0.31) * Math.cos(i * 0.113 + 1.3)) * 0.65 + Math.abs(Math.sin(i * 1.7)) * 0.35;
    const r1 = base + amp * wave;
    for (const r of [base, r1]) {
      const aa = a + (r === base ? 0 : (Math.PI / bars) * 0.5);
      pts.push(`${(0.5 + Math.cos(aa) * r).toFixed(4)} ${(0.5 + Math.sin(aa) * r).toFixed(4)}`);
    }
  }
  return `M${pts.join('L')}Z`;
}
