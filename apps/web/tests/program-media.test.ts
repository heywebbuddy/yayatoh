import { PROGRAM_IMAGES } from '@yayatoh/media';
import { describe, expect, it } from 'vitest';
import { defaultProgramAlt, PROGRAM_IMAGE_SLOT, sponsorLogoClass } from '../src/lib/program-media.ts';

describe('program images in the web app (M1.4h)', () => {
  it('slots mirror the media module', () => {
    for (const [kind, slot] of Object.entries(PROGRAM_IMAGE_SLOT))
      expect(PROGRAM_IMAGES[kind as keyof typeof PROGRAM_IMAGES].slot).toBe(slot);
    expect(Object.keys(PROGRAM_IMAGE_SLOT).sort()).toEqual(Object.keys(PROGRAM_IMAGES).sort());
  });

  it('suggests "Photo of {name}" for speakers and the company name for logos', () => {
    const photoOf = (name: string) => `Photo of ${name}`;
    expect(defaultProgramAlt('speaker', 'Ada Lovelace', photoOf)).toBe('Photo of Ada Lovelace');
    expect(defaultProgramAlt('exhibitor', ' Acme Robotics ', photoOf)).toBe('Acme Robotics');
    expect(defaultProgramAlt('sponsor', 'Globex', photoOf)).toBe('Globex');
    // Localized through the caller's message (Arabic: "صورة {name}").
    expect(defaultProgramAlt('speaker', 'ليلى', (n) => `صورة ${n}`)).toBe('صورة ليلى');
    // Always fits the 300-character alt limit.
    expect(defaultProgramAlt('speaker', 'x'.repeat(400), photoOf).length).toBeLessThanOrEqual(300);
  });

  it('sizes sponsor logos by tier rank: first tier largest', () => {
    expect(sponsorLogoClass(0)).toBe('h-20');
    expect(sponsorLogoClass(1)).toBe('h-14');
    expect(sponsorLogoClass(2)).toBe('h-10');
    expect(sponsorLogoClass(9)).toBe('h-10');
  });
});
