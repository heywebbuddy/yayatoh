import { qrPath } from '@yayatoh/pdf';

/**
 * Server-rendered QR for a signed yy1 ticket code: one SVG path, no client JS, no innerHTML.
 * The same path renders in ticket PDFs; dark modules use currentColor so colour comes from tokens.
 */
export function TicketQr({ code, label, className }: { code: string; label: string; className?: string }) {
  const { size, d } = qrPath(code);
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
