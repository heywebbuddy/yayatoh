import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer (PKWARE APPNOTE 6.3: local headers, deflate or store, central directory;
 * no ZIP64, so each archive stays under 4 GiB, far above one person's data). Entries keep the
 * given order and a fixed timestamp, so the same content always gives the same bytes.
 */
export interface ZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00 (the DOS epoch): a fixed time keeps archives reproducible. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    if (!/^[^/\\][^\\]*$/.test(e.path) || e.path.split('/').some((p) => p === '..' || p === ''))
      throw new Error(`zip: bad path ${e.path}`);
    if (seen.has(e.path)) throw new Error(`zip: duplicate path ${e.path}`);
    seen.add(e.path);
    const name = Buffer.from(e.path, 'utf8');
    const deflated = deflateRawSync(e.data);
    const store = deflated.length >= e.data.length;
    const body = store ? Buffer.from(e.data) : deflated;
    const crc = crc32(e.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(e.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(store ? 0 : 8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + body.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dirBytes, end]));
}

/** Read a ZIP this module wrote (tests and the verifier): path → bytes. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const buf = Buffer.from(bytes);
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('unzip: no end of central directory');
  const count = buf.readUInt16LE(endAt + 10);
  let p = buf.readUInt32LE(endAt + 16);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('unzip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const localName = buf.readUInt16LE(at + 26);
    const localExtra = buf.readUInt16LE(at + 28);
    const start = at + 30 + localName + localExtra;
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    if (crc32(data) !== buf.readUInt32LE(p + 16)) throw new Error(`unzip: CRC mismatch in ${name}`);
    out.set(name, new Uint8Array(data));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
