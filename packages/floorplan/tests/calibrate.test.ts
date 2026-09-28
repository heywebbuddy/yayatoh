import { describe, expect, it } from 'vitest';
import {
  calibrationScale,
  currentScale,
  FloorplanDoc,
  initialUnderlay,
  roomToImage,
  scaleUnderlay,
} from '../src/index.ts';

const img = {
  url: '/media/o/a/1280-x.webp',
  mediaId: '018f0000-0000-7000-8000-000000000001',
  width: 2000,
  height: 1000,
};

describe('floor plan image calibration (M1.7g)', () => {
  it('two points and a distance give centimetres per pixel', () => {
    // 500 px apart horizontally = 10 m → 2 cm per pixel.
    expect(calibrationScale({ x: 100, y: 200 }, { x: 600, y: 200 }, 10)).toEqual({ ok: true, cmPerPixel: 2 });
    // A 3-4-5 triangle: 500 px diagonal = 25 m → 5 cm per pixel.
    const r = calibrationScale({ x: 0, y: 0 }, { x: 300, y: 400 }, 25);
    expect(r.ok && r.cmPerPixel).toBeCloseTo(5, 10);
    // Order of the points doesn't matter.
    expect(calibrationScale({ x: 600, y: 200 }, { x: 100, y: 200 }, 10)).toEqual({ ok: true, cmPerPixel: 2 });
  });

  it('names every problem instead of guessing', () => {
    expect(calibrationScale({ x: 10, y: 10 }, { x: 12, y: 12 }, 5)).toEqual({
      ok: false,
      problem: 'points_too_close',
    });
    expect(calibrationScale({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toEqual({
      ok: false,
      problem: 'distance_out_of_range',
    });
    expect(calibrationScale({ x: 0, y: 0 }, { x: 100, y: 0 }, Number.NaN)).toEqual({
      ok: false,
      problem: 'distance_out_of_range',
    });
    expect(calibrationScale({ x: 0, y: 0 }, { x: 100, y: 0 }, 10_001)).toEqual({
      ok: false,
      problem: 'distance_out_of_range',
    });
    expect(calibrationScale({ x: 0, y: 0 }, { x: 2100, y: 0 }, 10, { width: 2000, height: 1000 })).toEqual({
      ok: false,
      problem: 'point_outside_image',
    });
  });

  it('a new image fits the room, then scales from its natural size and keeps its corner', () => {
    const u = initialUnderlay(img, { width: 3000, height: 3000 });
    expect(u).toMatchObject({
      x: 0,
      y: 0,
      width: 3000,
      height: 1500,
      opacity: 0.5,
      locked: false,
      showOnMap: false,
    });
    expect(currentScale({ width: u.width, imageWidth: 2000 })).toBe(1.5);
    const scaled = scaleUnderlay({ ...u, x: 40, y: 60, imageWidth: 2000, imageHeight: 1000 }, 2);
    expect(scaled).toMatchObject({ x: 40, y: 60, width: 4000, height: 2000 });
    expect(scaleUnderlay({ ...u, imageWidth: 2000, imageHeight: 1000 }, 0.0001)).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it('maps a click in room centimetres to the image pixel under it', () => {
    const u = { x: 100, y: 200, width: 4000, height: 2000, imageWidth: 2000, imageHeight: 1000 };
    expect(roomToImage(u, { x: 100, y: 200 })).toEqual({ x: 0, y: 0 });
    expect(roomToImage(u, { x: 4100, y: 2200 })).toEqual({ x: 2000, y: 1000 });
    expect(roomToImage(u, { x: 1100, y: 700 })).toEqual({ x: 500, y: 250 });
  });

  it('documents keep old underlays valid and default the new fields', () => {
    const doc = FloorplanDoc.parse({
      version: 1,
      width: 100,
      height: 100,
      underlay: { url: '/legacy/chart.png', x: 0, y: 0, width: 100, height: 100 },
      items: [],
    });
    expect(doc.underlay).toMatchObject({ opacity: 0.5, locked: false, showOnMap: false });
    expect(
      FloorplanDoc.safeParse({
        version: 1,
        width: 100,
        height: 100,
        underlay: { url: 'x', x: 0, y: 0, width: 1, height: 1, opacity: 0 },
        items: [],
      }).success,
    ).toBe(false);
  });
});
