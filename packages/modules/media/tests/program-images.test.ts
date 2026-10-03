import { describe, expect, it } from 'vitest';
import { UpdateProgramAltInput, UploadProgramImageInput } from '../src/dto.ts';
import { familyOf, isProgramOwner, PROGRAM_IMAGES } from '../src/media.ts';
import { OWNER_TYPES } from '../src/schema.ts';
import { UploadTicket } from '../src/ticket.ts';

const id = '01900000-0000-7000-8000-000000000001';

describe('program images: entity → media ownership (M1.4h)', () => {
  it('a speaker owns a photo, exhibitors and sponsors a logo, each under its own entitlement', () => {
    expect(PROGRAM_IMAGES).toEqual({
      speaker: { slot: 'photo', entitlement: 'speakers', command: 'SpeakerPhoto' },
      exhibitor: { slot: 'logo', entitlement: 'exhibitors', command: 'ExhibitorLogo' },
      sponsor: { slot: 'logo', entitlement: 'sponsors', command: 'SponsorLogo' },
    });
    for (const kind of Object.keys(PROGRAM_IMAGES)) expect(OWNER_TYPES).toContain(kind);
  });

  it('each owner type belongs to exactly one command family', () => {
    expect(OWNER_TYPES.map((t) => [t, familyOf(t)])).toEqual([
      ['event', 'content'],
      ['venue', 'content'],
      ['org', 'logo'],
      ['speaker', 'speaker'],
      ['exhibitor', 'exhibitor'],
      ['sponsor', 'sponsor'],
      // U10: library images are content (event editors upload, place and delete them).
      ['library', 'content'],
    ]);
    expect(['speaker', 'exhibitor', 'sponsor'].every(isProgramOwner)).toBe(true);
    expect(['event', 'venue', 'org', 'library', 'constructor', 'toString'].some(isProgramOwner)).toBe(false);
  });

  it('program images always need alt text and can never be decorative', () => {
    const base = { assetId: id, ownerId: id, file: new Uint8Array([1]) };
    expect(UploadProgramImageInput.safeParse({ ...base, alt: 'Photo of Ada' }).success).toBe(true);
    for (const alt of [null, '', '   ']) {
      const r = UploadProgramImageInput.safeParse({ ...base, alt });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(['alt']);
    }
    // A client can't smuggle `decorative` in: it is not part of the input.
    const parsed = UploadProgramImageInput.parse({ ...base, alt: 'Logo', decorative: true });
    expect(parsed).not.toHaveProperty('decorative');
    expect(UploadProgramImageInput.safeParse({ ...base, alt: 'x'.repeat(301) }).success).toBe(false);
    expect(UpdateProgramAltInput.safeParse({ assetId: id, alt: '' }).success).toBe(false);
    expect(UpdateProgramAltInput.safeParse({ assetId: id, alt: 'Acme' }).success).toBe(true);
  });

  it('upload tickets can name program owners and their slots', () => {
    for (const [ownerType, spec] of Object.entries(PROGRAM_IMAGES))
      expect(
        UploadTicket.safeParse({
          orgId: id,
          ownerType,
          ownerId: id,
          slot: spec.slot,
          userId: 'u',
          expiresAt: 1,
        }).success,
      ).toBe(true);
  });
});
