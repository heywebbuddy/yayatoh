/**
 * The ticket's QR code (M7.3b, ADR 0011). The string is the server's signed code, drawn as it
 * comes: the app never signs or alters it. Error correction M with a four-module quiet zone, as
 * the web and the PDF draw it, in black on white at every theme (a scanner needs the contrast).
 */
import { constant } from '@yayatoh/ui/tokens';
import QRCode from 'qrcode';
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

const QUIET_ZONE = 4;

/** One SVG path for every dark module, and the side length in modules (quiet zone included). */
export function qrPath(code: string): { size: number; d: string } {
  const { modules } = QRCode.create(code, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let d = '';
  for (let y = 0; y < n; y++) {
    // Runs of dark modules in a row become one rectangle.
    let x = 0;
    while (x < n) {
      if (!modules.get(y, x)) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < n && modules.get(y, x)) x += 1;
      d += `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`;
    }
  }
  return { size: n + QUIET_ZONE * 2, d };
}

export interface TicketQrProps {
  readonly code: string;
  /** What a screen reader says: "Ticket QR code for <event>". */
  readonly label: string;
  readonly size: number;
}

export function TicketQr({ code, label, size }: TicketQrProps) {
  const { size: modules, d } = useMemo(() => qrPath(code), [code]);
  return (
    <View
      testID="ticket-qr"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size, backgroundColor: constant.white }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${modules} ${modules}`} shapeRendering="crispEdges">
        <Rect width={modules} height={modules} fill={constant.white} />
        <Path d={d} fill={constant.black} />
      </Svg>
    </View>
  );
}
