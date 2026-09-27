/** Reads a QR code from the current video frame, or null when there is none. */
export type Decode = (video: HTMLVideoElement) => Promise<string | null>;

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (o: { formats: string[] }) => NativeDetector;

/** Frames wider than this are scaled down before decoding: plenty for a QR held up to a phone. */
const MAX_WIDTH = 960;

export const canUseCamera = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * The browser's BarcodeDetector where there is one (Chrome, Android). Elsewhere, notably iOS
 * Safari, zxing-wasm: loaded only when the camera is first used, from our own origin under a
 * content-hashed name (written by scripts/copy-zxing.ts), so the service worker keeps it offline.
 */
export async function createDecoder(): Promise<Decode> {
  const Native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Native) {
    const detector = new Native({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null;
  }
  const zxing = await import('zxing-wasm/reader');
  const wasmUrl = `/scan-zxing-${zxing.ZXING_WASM_SHA256.slice(0, 16)}.wasm`;
  await zxing.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
    fireImmediately: true,
  });
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!g || !video.videoWidth) return null;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const [hit] = await zxing
      .readBarcodes(g.getImageData(0, 0, canvas.width, canvas.height), {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
      })
      .catch(() => []);
    return hit?.isValid ? hit.text : null;
  };
}
