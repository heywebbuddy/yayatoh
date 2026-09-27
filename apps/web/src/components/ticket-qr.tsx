import QRCode from 'qrcode';

/**
 * Server-rendered QR for a signed yy1 ticket code: one SVG path, no client JS, no innerHTML.
 * Error correction M (ADR 0011); dark modules use currentColor so the colour comes from tokens.
 */
export function TicketQr({ code, label, className }: { code: string; label: string; className?: string }) {
  const { modules } = QRCode.create(code, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const quiet = 4;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules.get(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const size = n + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="white" />
      <path d={d} fill="currentColor" />
    </svg>
  );
}
