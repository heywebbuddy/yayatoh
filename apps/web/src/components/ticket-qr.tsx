import { qrPath } from '@yayatoh/pdf';

/**
 * Server-rendered QR for a signed yy1 ticket code: one SVG path, no client JS, no innerHTML.
 * The same path renders in ticket PDFs; modules stay near-black on the white code surface so a
 * surrounding muted text colour cannot lower the QR's scan contrast.
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
      <path d={d} fill="#111827" />
    </svg>
  );
}
