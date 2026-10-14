// Generates the four verdict sounds (M7.4b) as small mono WAV files: `node tools/make-staff-sounds.mjs`.
// Each is a different rhythm and pitch, so a door can tell them apart without looking:
//   admit      one short rising chirp
//   warn       two mid beeps (provisional: admitted but flagged)
//   duplicate  three quick low beeps
//   stop       one long low buzz
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const out = (name) => fileURLToPath(new URL(`../apps/staff/assets/sounds/${name}.wav`, import.meta.url));

function tone(freq, ms, { to = freq, shape = 'sine', gain = 0.6 } = {}) {
  const n = Math.round((RATE * ms) / 1000);
  const samples = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = freq + ((to - freq) * i) / n;
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, i / 160, (n - i) / 400); // short attack and release: no clicks
    const wave = shape === 'square' ? Math.sign(Math.sin(phase)) * 0.7 : Math.sin(phase);
    samples[i] = wave * env * gain;
  }
  return samples;
}
const silence = (ms) => new Float32Array(Math.round((RATE * ms) / 1000));
const join = (...parts) => {
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
};

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (const [i, s] of samples.entries())
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const sounds = {
  admit: join(tone(660, 90), tone(990, 160, { to: 1320 })),
  warn: join(tone(740, 150), silence(70), tone(740, 150)),
  duplicate: join(tone(330, 90), silence(60), tone(330, 90), silence(60), tone(330, 90)),
  stop: tone(150, 600, { to: 120, shape: 'square', gain: 0.5 }),
};
for (const [name, samples] of Object.entries(sounds)) writeFileSync(out(name), wav(samples));
