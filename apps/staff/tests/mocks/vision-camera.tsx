/** A stand-in for `react-native-vision-camera` (it needs native modules): records what the scanner asks of it. */
import type { ReactNode } from 'react';
import { View } from 'react-native';

export const camera = {
  permission: 'authorized' as 'authorized' | 'not-determined' | 'denied' | 'restricted',
  device: { id: 'back', hasTorch: true } as { id: string; hasTorch: boolean } | undefined,
  request: jest.fn(async () => true),
  props: null as Record<string, unknown> | null,
  output: null as { types: string[]; onObjectsScanned: (objects: unknown[]) => void } | null,
  reset() {
    this.permission = 'authorized';
    this.device = { id: 'back', hasTorch: true };
    this.request = jest.fn(async () => true);
    this.props = null;
    this.output = null;
  },
  /** What the native camera does when it sees a QR code. */
  see(value: string) {
    this.output?.onObjectsScanned([{ type: 'qr', value, boundingBox: {}, cornerPoints: [] }]);
  },
};

export function Camera(props: Record<string, unknown>): ReactNode {
  camera.props = props;
  return <View testID="vision-camera" />;
}
export const useCameraPermission = () => ({
  status: camera.permission,
  requestPermission: camera.request,
  hasPermission: camera.permission === 'authorized',
  canRequestPermission: camera.permission === 'not-determined',
});
export const useCameraDevice = () => camera.device;
export const useObjectOutput = (options: { types: string[]; onObjectsScanned: (o: unknown[]) => void }) => {
  camera.output = options;
  return { kind: 'object-output' };
};
export const isScannedCode = (o: object) => 'value' in o;
