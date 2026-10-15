// Maestro script: the current authenticator code (RFC 6238: HMAC-SHA-1, 6 digits, 30 s) for SETUP_KEY,
// the base32 setup key scripts/new-organizer.js returned. The result is ${output.totp}.
// Maestro has no crypto library, so SHA-1 and HMAC are written out here.
// (tools/check-maestro/tests/scripts.test.ts runs this exact file against the RFC 6238 vectors and Node's HMAC.)
function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(text)
    .toUpperCase()
    .replace(/[\s=-]/g, '');
  const out = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Not a base32 setup key');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out;
}

function rotl(n, s) {
  return (n << s) | (n >>> (32 - s));
}

function sha1(bytes) {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const message = bytes.slice();
  const bitLength = bytes.length * 8;
  message.push(0x80);
  while (message.length % 64 !== 56) message.push(0);
  const high = Math.floor(bitLength / 4294967296);
  const low = bitLength >>> 0;
  message.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255);
  message.push((low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);
  for (let offset = 0; offset < message.length; offset += 64) {
    const w = [];
    for (let t = 0; t < 16; t++) {
      const j = offset + t * 4;
      w[t] = (message[j] << 24) | (message[j + 1] << 16) | (message[j + 2] << 8) | message[j + 3] | 0;
    }
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f;
      let k;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out = [];
  for (const word of [h0, h1, h2, h3, h4])
    out.push((word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255);
  return out;
}

function hmacSha1(key, message) {
  const block = key.length > 64 ? sha1(key) : key.slice();
  while (block.length < 64) block.push(0);
  const inner = [];
  const outer = [];
  for (let i = 0; i < 64; i++) {
    inner.push(block[i] ^ 0x36);
    outer.push(block[i] ^ 0x5c);
  }
  return sha1(outer.concat(sha1(inner.concat(message))));
}

const counter = Math.floor(Date.now() / 1000 / 30);
const counterBytes = [
  0,
  0,
  0,
  0,
  (counter >>> 24) & 255,
  (counter >>> 16) & 255,
  (counter >>> 8) & 255,
  counter & 255,
];
const mac = hmacSha1(base32Decode(SETUP_KEY), counterBytes);
const offset = mac[mac.length - 1] & 15;
const binary =
  ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
output.totp = String(binary % 1000000).padStart(6, '0');
