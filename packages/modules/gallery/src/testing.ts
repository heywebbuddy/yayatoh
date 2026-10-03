import { FAKE_HEIC_BOX } from './ports.ts';

const box = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
};

/**
 * A test "HEIC" (M4.5b): a real `ftyp heic` header, so the gallery sniffs it as HEIC, followed by
 * a `yyfk` box holding a JPEG or PNG that the dev decoder returns. Real HEVC pictures need a
 * decoder with a HEVC codec (owner inbox).
 */
export function fakeHeic(picture: Uint8Array): Uint8Array {
  const ftyp = box('ftyp', new TextEncoder().encode('heic\0\0\0\0mif1heic'));
  const pic = box(FAKE_HEIC_BOX, picture);
  const out = new Uint8Array(ftyp.length + pic.length);
  out.set(ftyp, 0);
  out.set(pic, ftyp.length);
  return out;
}
