'use client';

import { type RefObject, useEffect } from 'react';
import { createDecoder } from './camera.ts';

/**
 * Camera scanning while `on`: BarcodeDetector, or the zxing-wasm fallback (iOS Safari). The same
 * code is not reported twice in a row. `onError` runs when the camera can't start.
 */
export function useCameraScan(
  on: boolean,
  video: RefObject<HTMLVideoElement | null>,
  onCode: (code: string) => Promise<void> | void,
  onError: () => void,
): void {
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let stop = false;
    let lastCode = '';
    void (async () => {
      const decode = await createDecoder();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (stop || !video.current) {
        // Closed while the permission prompt was up: release the camera now.
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.current.srcObject = stream;
      await video.current.play();
      while (!stop && video.current) {
        const code = await decode(video.current);
        if (code && code !== lastCode) {
          lastCode = code;
          await onCode(code);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    })().catch(onError);
    return () => {
      stop = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [on, video, onCode, onError]);
}
