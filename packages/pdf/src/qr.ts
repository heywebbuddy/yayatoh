import QRCode from 'qrcode';

/** A QR as one SVG path (error correction M, ADR 0011) with a 4-module quiet zone. */
export function qrPath(code: string): { size: number; d: string } {
  const { modules } = QRCode.create(code, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const quiet = 4;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules.get(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return { size: n + quiet * 2, d };
}
