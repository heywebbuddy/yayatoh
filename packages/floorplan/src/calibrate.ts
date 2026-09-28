import type { Underlay } from './document.ts';

/** A point in the image's own pixels (origin top-left). */
export interface ImagePoint {
  readonly x: number;
  readonly y: number;
}

/** The distance the organizer may enter between two calibration points: 1 cm to 10 km. */
export const CALIBRATION_METRES = { min: 0.01, max: 10_000 } as const;
/** Points closer than this (in image pixels) can't give a reliable scale. */
export const MIN_CALIBRATION_PIXELS = 5;

export type CalibrationProblem = 'points_too_close' | 'distance_out_of_range' | 'point_outside_image';

/**
 * Two-point calibration (M1.7g): the organizer marks two points on the image and enters the real
 * distance between them in metres. Returns centimetres per image pixel, or why it can't.
 */
export function calibrationScale(
  a: ImagePoint,
  b: ImagePoint,
  metres: number,
  image?: { readonly width: number; readonly height: number },
): { ok: true; cmPerPixel: number } | { ok: false; problem: CalibrationProblem } {
  if (!Number.isFinite(metres) || metres < CALIBRATION_METRES.min || metres > CALIBRATION_METRES.max)
    return { ok: false, problem: 'distance_out_of_range' };
  if (image) {
    for (const p of [a, b])
      if (!(p.x >= 0 && p.y >= 0 && p.x <= image.width && p.y <= image.height))
        return { ok: false, problem: 'point_outside_image' };
  }
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(pixels) || pixels < MIN_CALIBRATION_PIXELS)
    return { ok: false, problem: 'points_too_close' };
  return { ok: true, cmPerPixel: (metres * 100) / pixels };
}

/** The underlay resized to a scale, keeping its top-left corner (whole centimetres, at least 1). */
export function scaleUnderlay(
  u: Underlay & { imageWidth: number; imageHeight: number },
  cmPerPixel: number,
): Underlay {
  return {
    ...u,
    width: Math.max(1, Math.round(u.imageWidth * cmPerPixel)),
    height: Math.max(1, Math.round(u.imageHeight * cmPerPixel)),
  };
}

/** A point in room centimetres → the same point in the image's pixels (for clicks on the canvas). */
export function roomToImage(
  u: Pick<Underlay, 'x' | 'y' | 'width' | 'height'> & { imageWidth: number; imageHeight: number },
  p: { readonly x: number; readonly y: number },
): ImagePoint {
  return {
    x: Math.round(((p.x - u.x) * u.imageWidth) / u.width),
    y: Math.round(((p.y - u.y) * u.imageHeight) / u.height),
  };
}

/** The image's current scale in centimetres per pixel (its width over its natural width). */
export const currentScale = (u: { width: number; imageWidth: number }) => u.width / u.imageWidth;

/**
 * A new underlay for an uploaded image: at the room's top-left, scaled so it fits the room's
 * width (the organizer then calibrates it).
 */
export function initialUnderlay(
  img: { url: string; mediaId: string; width: number; height: number },
  room: { width: number; height: number },
): Underlay {
  const cmPerPixel = Math.min(room.width / img.width, room.height / img.height);
  return {
    url: img.url,
    mediaId: img.mediaId,
    imageWidth: img.width,
    imageHeight: img.height,
    x: 0,
    y: 0,
    width: Math.max(1, Math.round(img.width * cmPerPixel)),
    height: Math.max(1, Math.round(img.height * cmPerPixel)),
    opacity: 0.5,
    locked: false,
    showOnMap: false,
  };
}
