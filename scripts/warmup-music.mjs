// The warm-up ad's soundtrack, written from scratch (no samples, no third-party music), synced to the video's cuts:
// brand/src/warmup-ad.html runs on the same grid, 106.67 bpm, so a beat is 0.5625 s and a bar (one rule card) 2.25 s.
// Upbeat G major: plucks climbing with the pump, a tape-stop "bwomp" and a sad trombone at the dump, a muffled groove
// with message pops under the replies, a build into "rules?", then the drop (four-on-the-floor, clap, octave bass, offbeat
// stabs, a chiptune lead) with a hit for every on-screen moment (wipes, the fee falling, REFUSED stamps, the lock, the cap,
// the copycat), a breakdown for the lock lines, and a ta-da into the end card.
//   node scripts/warmup-music.mjs      -> brand/warmup-music.wav, brand/warmup-ad-music.mp4 (brand/warmup-ad.mp4 + this)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SR = 44100;
const B = 0.5625; // a beat
const TOTAL = 51 * B; // the video's length
const N = Math.ceil((TOTAL + 1) * SR);
const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const main = bus(), groove = bus(), send = bus(), echo = bus();
const at = (beat) => beat * B; // seconds

// deterministic noise, so every render is the same
let seed = 0x5eed;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296 * 2 - 1; };
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const lpA = (fc) => 1 - Math.exp((-2 * Math.PI * Math.min(fc, SR * 0.45)) / SR);

function put(b, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  const a = ((pan + 1) * Math.PI) / 4;
  b.L[i] += v * Math.cos(a);
  b.R[i] += v * Math.sin(a);
}
/** a voice: f(tt, n) gives the sample at tt seconds into it; written into a bus, and optionally the reverb/echo sends */
function voice(t, dur, f, { to = main, pan = 0, rev = 0, dly = 0 } = {}) {
  const i0 = Math.round(t * SR), n = Math.round(dur * SR);
  for (let k = 0; k < n; k++) {
    const v = f(k / SR, k);
    put(to, i0 + k, v, pan);
    if (rev) put(send, i0 + k, v * rev, pan);
    if (dly) put(echo, i0 + k, v * dly, pan);
  }
}
const env = (tt, dur, a = 0.004, r = 0.05) => Math.min(1, tt / a) * Math.min(1, Math.max(0, (dur - tt) / r));

// ---------------------------------------------------------------- drums
function kick(t, vol = 1, to = main) {
  let ph = 0;
  voice(t, 0.45, (tt) => { const f = 46 + 120 * Math.exp(-tt * 30); ph += (2 * Math.PI * f) / SR; return (Math.sin(ph) * Math.exp(-tt * 7) + rnd() * 0.25 * Math.exp(-tt * 260)) * vol; }, { to });
}
function clap(t, vol = 0.55, to = main) {
  let lp = 0, lp2 = 0;
  const a1 = lpA(5500), a2 = lpA(1100);
  voice(t, 0.32, (tt) => {
    const burst = [0, 0.011, 0.022].reduce((s, o) => s + (tt >= o ? Math.exp(-(tt - o) * 90) : 0), 0) * 0.5 + Math.exp(-tt * 14) * 0.6;
    const x = rnd(); lp += a1 * (x - lp); lp2 += a2 * (lp - lp2);
    return ((lp - lp2) * burst * 1.6 + Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt * 28) * 0.25) * vol;
  }, { to, rev: 0.25 });
}
function hat(t, vol = 0.16, open = false, pan = 0.25, to = main) {
  let lp = 0;
  const a = lpA(7500);
  voice(t, open ? 0.28 : 0.06, (tt) => { const x = rnd(); lp += a * (x - lp); return (x - lp) * Math.exp(-tt * (open ? 11 : 75)) * vol; }, { to, pan });
}
function crash(t, vol = 0.32, dur = 1.8) {
  let lp = 0;
  const a = lpA(4200);
  voice(t, dur, (tt) => { const x = rnd(); lp += a * (x - lp); return (x - lp) * Math.exp(-tt * 2.2) * vol; }, { pan: -0.15, rev: 0.4 });
}

// ---------------------------------------------------------------- synths
function bass(t, m, dur, vol = 0.42, to = groove) {
  let ph = 0, lp = 0;
  const f = mtof(m);
  voice(t, dur, (tt) => {
    ph = (ph + f / SR) % 1;
    const saw = ph * 2 - 1, sub = Math.sin(2 * Math.PI * ph);
    lp += lpA(260 + 1700 * Math.exp(-tt * 14)) * (saw - lp);
    return (lp * 0.7 + sub * 0.55) * env(tt, dur, 0.003, 0.03) * vol;
  }, { to });
}
/** the chiptune lead: a 25% square, a little vibrato once it's held */
function lead(t, m, dur, vol = 0.16, pan = 0) {
  let ph = 0, lp = 0;
  voice(t, dur, (tt) => {
    const vib = tt > 0.14 ? Math.sin(2 * Math.PI * 5.6 * tt) * 0.12 : 0;
    ph = (ph + mtof(m + vib) / SR) % 1;
    const sq = ph < 0.25 ? 1 : -1;
    lp += lpA(4200) * (sq - lp);
    const a = Math.min(1, tt / 0.004) * (0.55 + 0.45 * Math.exp(-tt * 18)) * Math.min(1, Math.max(0, (dur - tt) / 0.05));
    return lp * a * vol;
  }, { pan, rev: 0.18, dly: 0.28 });
}
function pluck(t, m, dur, vol = 0.14, pan = 0) {
  let ph = 0, lp = 0;
  voice(t, dur, (tt) => {
    ph = (ph + mtof(m) / SR) % 1;
    const sq = ph < 0.5 ? 1 : -1;
    lp += lpA(900 + 5000 * Math.exp(-tt * 20)) * (sq - lp);
    return lp * Math.exp(-tt * 9) * env(tt, dur, 0.002, 0.03) * vol;
  }, { pan, rev: 0.22, dly: 0.2 });
}
function stab(t, ms, dur = 0.2, vol = 0.07, to = groove) {
  ms.forEach((m, j) => {
    let ph = 0, lp = 0;
    voice(t, dur, (tt) => { ph = (ph + mtof(m) / SR) % 1; lp += lpA(700 + 2600 * Math.exp(-tt * 16)) * (ph * 2 - 1 - lp); return lp * Math.exp(-tt * 8) * env(tt, dur, 0.002, 0.04) * vol; }, { to, pan: (j - 1) * 0.35, rev: 0.15 });
  });
}
function pad(t, ms, dur, vol = 0.05) {
  ms.forEach((m, j) => [-0.08, 0, 0.08].forEach((det, d) => {
    let ph = rnd() * 0.5 + 0.5, lp = 0;
    voice(t, dur, (tt) => { ph = (ph + mtof(m + det) / SR) % 1; lp += lpA(1300) * (ph * 2 - 1 - lp); return lp * Math.min(1, tt / 0.35) * Math.min(1, Math.max(0, (dur - tt) / 0.6)) * vol; }, { pan: (d - 1) * 0.6, rev: 0.35 });
  }));
}

// ---------------------------------------------------------------- effects
function whoosh(t, vol = 0.2, up = true) {
  let lp = 0, lp2 = 0;
  voice(t - 0.24, 0.5, (tt) => {
    const p = tt / 0.5, fc = up ? 400 + 7000 * p : 7400 - 7000 * p;
    const x = rnd(); lp += lpA(fc * 1.6) * (x - lp); lp2 += lpA(fc * 0.6) * (lp - lp2);
    return (lp - lp2) * Math.sin(Math.PI * p) ** 2 * vol * 2.2;
  }, { pan: 0, rev: 0.2 });
}
function riser(t, dur, vol = 0.18) {
  let lp = 0, lp2 = 0;
  voice(t, dur, (tt) => { const p = tt / dur, fc = 300 * 2 ** (p * 5); const x = rnd(); lp += lpA(fc * 1.5) * (x - lp); lp2 += lpA(fc * 0.7) * (lp - lp2); return (lp - lp2) * p * p * vol * 2; }, { rev: 0.3 });
}
function sweep(t, dur, f0, f1, vol = 0.1, pan = 0) {
  let ph = 0;
  voice(t, dur, (tt) => { const f = f0 * (f1 / f0) ** (tt / dur); ph += (2 * Math.PI * f) / SR; return Math.sin(ph) * env(tt, dur, 0.01, 0.08) * vol; }, { pan, rev: 0.3, dly: 0.2 });
}
/** a message pop: two quick rising sines */
function popSfx(t, pan) {
  [[0, 1046, 1568], [0.055, 1568, 2093]].forEach(([o, f0, f1]) => sweep(t + o, 0.07, f0, f1, 0.16, pan));
}
function stampSfx(t) {
  kick(t, 1.1);
  clap(t, 0.8);
  let lp = 0;
  voice(t, 0.35, (tt) => { const x = rnd(); lp += lpA(2400) * (x - lp); return Math.tanh(lp * 6) * Math.exp(-tt * 16) * 0.22; }, { rev: 0.2 });
}
function clickSfx(t, vol = 0.3) {
  voice(t, 0.05, (tt) => (rnd() * 0.5 + Math.sin(2 * Math.PI * 3200 * tt)) * Math.exp(-tt * 140) * vol, { rev: 0.25, pan: 0.2 });
  voice(t + 0.02, 0.12, (tt) => Math.sin(2 * Math.PI * 140 * tt) * Math.exp(-tt * 30) * vol, {});
}
function bonk(t) {
  let ph = 0;
  voice(t, 0.35, (tt) => { const f = 420 * Math.exp(-tt * 9) + 110; ph += (2 * Math.PI * f) / SR; return Math.sin(ph) * Math.exp(-tt * 9) * 0.32; }, { rev: 0.2 });
}
function buzzer(t, dur = 0.26) {
  let ph = 0, lp = 0;
  voice(t, dur, (tt) => { ph = (ph + 116 / SR) % 1; lp += lpA(1800) * ((ph < 0.5 ? 1 : -1) - lp); return lp * env(tt, dur, 0.005, 0.03) * 0.13; }, {});
}
function slash(t) {
  let lp = 0;
  voice(t, 0.22, (tt) => { const p = tt / 0.22; const x = rnd(); lp += lpA(2000 + 9000 * p) * (x - lp); return (x - lp) * Math.sin(Math.PI * p) * 0.35; }, { pan: -0.3, rev: 0.2 });
}
/** the dump: a tape-stop on a low saw, a sub boom */
function dumpSfx(t) {
  let ph = 0, ph2 = 0, lp = 0;
  voice(t, 0.9, (tt) => {
    const f = 196 * Math.exp(-tt * 3.2); ph = (ph + f / SR) % 1; lp += lpA(1400 * Math.exp(-tt * 2)) * (ph * 2 - 1 - lp);
    const fs = 62 * Math.exp(-tt * 1.2); ph2 += (2 * Math.PI * fs) / SR;
    return (lp * 0.35 + Math.sin(ph2) * 0.6) * Math.exp(-tt * 3);
  }, { rev: 0.2 });
  crash(t, 0.28, 1.4);
}
/** the sad trombone: a brassy saw with a wah, sliding down */
function trombone(t, m, dur, vib = 0) {
  let ph = 0, lp = 0;
  voice(t, dur, (tt) => {
    const wob = vib ? Math.sin(2 * Math.PI * 6.5 * tt) * vib * Math.min(1, tt / 0.3) : 0;
    ph = (ph + mtof(m + wob - 0.15 * Math.min(1, tt / dur)) / SR) % 1;
    const wah = 350 + 1300 * Math.sin(Math.PI * Math.min(1, tt / Math.min(dur, 0.45)));
    lp += lpA(wah) * (ph * 2 - 1 - lp);
    return lp * env(tt, dur, 0.04, 0.12) * 0.28;
  }, { rev: 0.3, pan: 0.1 });
}
function sparkle(t, n = 6) {
  for (let k = 0; k < n; k++) sweep(t + k * 0.07, 0.35, mtof(91 + ((k * 5) % 12)), mtof(91 + ((k * 5) % 12)) * 1.01, 0.05, k % 2 ? 0.6 : -0.6);
}

// ---------------------------------------------------------------- the score
const PROG = { G: [43, [55, 59, 62]], D: [38, [54, 57, 62]], Em: [40, [55, 59, 64]], C: [36, [55, 60, 64]] };
const ORDER = ['G', 'D', 'Em', 'C'];
const chordAt = (beat) => ORDER[((Math.floor((beat - 13) / 4) % 4) + 4) % 4];
// the lead: [16th step, length in 16ths, note] per chord
const MOTIF = {
  G: [[0, 2, 74], [2, 2, 71], [4, 2, 67], [6, 2, 71], [8, 3, 74], [11, 1, 76], [12, 4, 74]],
  D: [[0, 2, 69], [2, 2, 66], [4, 2, 62], [6, 2, 66], [8, 3, 69], [11, 1, 71], [12, 4, 69]],
  Em: [[0, 2, 71], [2, 2, 67], [4, 2, 64], [6, 2, 67], [8, 3, 71], [11, 1, 72], [12, 4, 71]],
  C: [[0, 2, 72], [2, 2, 67], [4, 2, 64], [6, 2, 67], [8, 2, 72], [10, 2, 74], [12, 2, 76], [14, 2, 79]],
};
const S16 = B / 4;

/** one bar of the full groove from beat b0 */
function grooveBar(b0, { lead: withLead = true, light = false } = {}) {
  const c = chordAt(b0), [root, triad] = PROG[c];
  for (let k = 0; k < 4; k++) {
    kick(at(b0 + k), light ? 0.8 : 1);
    if (k % 2) clap(at(b0 + k));
    hat(at(b0 + k + 0.5), 0.12, true, -0.3);
  }
  if (!light) for (let s = 0; s < 16; s++) hat(at(b0) + s * S16, s % 2 ? 0.1 : 0.06, false, 0.3);
  [0, 12, 0, 12, 0, 12, 7, 12].forEach((o, k) => bass(at(b0) + k * 2 * S16, root + o, S16 * 1.6, 0.4));
  [2, 6, 10, 14].forEach((s) => stab(at(b0) + s * S16, triad));
  if (withLead) MOTIF[c].forEach(([s, len, m]) => lead(at(b0) + s * S16, m, len * S16 * 0.92));
}

// 0-2: the pump: plucks climb with the chart
[67, 71, 74, 79, 74, 79, 83, 86].forEach((m, k) => pluck(k * S16, m, S16 * 1.8, 0.13, k % 2 ? 0.3 : -0.3));
kick(0, 0.9); kick(at(1), 0.9);
for (let s = 0; s < 8; s++) hat(s * S16, 0.08);
riser(0, at(2) - 0.02, 0.12);
bass(0, 43, at(2) - 0.05, 0.3, main);

// 2: the dump, then a sad trombone
dumpSfx(at(2));
trombone(at(2.75), 58, 0.42); trombone(at(3.35), 57, 0.42); trombone(at(3.95), 56, 0.42); trombone(at(4.55), 55, 0.95, 0.55);

// 5-10: the replies, over a muffled groove (the groove bus is filtered open by beat 10)
for (let b = 5; b < 10; b++) {
  kick(at(b), 0.85, groove);
  hat(at(b + 0.5), 0.1, true, -0.3, groove);
  if (b % 2 === 0) clap(at(b), 0.5, groove);
  const [root] = PROG[chordAt(b)];
  [0, 12].forEach((o, k) => bass(at(b) + k * 2 * S16, root + o, S16 * 1.6, 0.36));
  [0, 12].forEach((o, k) => bass(at(b + 0.5) + k * 2 * S16 / 2, root + o, S16 * 0.9, 0.3));
}
[6, 7, 8, 9].forEach((b, i) => popSfx(at(b), i % 2 ? 0.5 : -0.5));
riser(at(8), at(2), 0.2);
for (let s = 0; s < 8; s++) clap(at(8.5) + s * S16, 0.18 + s * 0.03, groove);
for (let s = 0; s < 8; s++) clap(at(10.5) + s * (S16 / 2), 0.2 + s * 0.04);

// 10-13: the question, then RULES? slams on 12 and the drop lands on 13
whoosh(at(10), 0.22);
pad(at(10), PROG.C[1], at(2.1), 0.045);
[0, 1, 2, 3, 4, 5, 6, 7].forEach((k) => pluck(at(10) + k * 2 * S16, [64, 67, 72, 76, 72, 76, 79, 84][k], S16 * 1.6, 0.09, k % 2 ? 0.4 : -0.4));
kick(at(12), 1.2); crash(at(12), 0.36); stab(at(12), [55, 59, 62, 67], 0.5, 0.1, main);
sweep(at(12), 0.5, 180, 60, 0.4);
riser(at(12.2), at(0.8), 0.22);

// 13-37: the six rules, the full groove, a hit for each moment on screen
for (let card = 0; card < 6; card++) grooveBar(13 + card * 4);
[13, 17, 21, 25, 29, 33].forEach((b) => whoosh(at(b), 0.16));
crash(at(13), 0.3);
sweep(at(13.6), at(2.6), 1900, 260, 0.06, 0.2);       // the fee falls 99% -> 1%
stampSfx(at(19)); stampSfx(at(23));                   // REFUSED, REFUSED
clickSfx(at(26), 0.35);                               // block 0 locks
bonk(at(31));                                         // the cap
slash(at(34.5)); buzzer(at(35));                      // the copycat
crash(at(29), 0.18);

// 37-41: the lock lines (a breakdown), the lock clicks on 40
pad(at(37), PROG.Em[1], at(4.1), 0.05);
[37, 38, 39].forEach((b) => { kick(at(b), 1); stab(at(b), PROG.Em[1], 0.3, 0.08, main); });
clickSfx(at(40), 0.45); kick(at(40), 0.9);
riser(at(40), at(1), 0.2);
for (let s = 0; s < 8; s++) clap(at(40) + s * (S16 / 2), 0.15 + s * 0.04);

// 41-45: the product: the groove's back
whoosh(at(41), 0.2); crash(at(41), 0.25);
grooveBar(41);

// 45-51: soon: a ta-da, sparkles, a last bar, the final chord
whoosh(at(45), 0.2);
kick(at(45), 1.2); crash(at(45), 0.36, 2.4); stab(at(45), [55, 59, 62, 67], 0.6, 0.1, main);
[79, 83, 86, 91].forEach((m, k) => lead(at(45) + k * S16, m, k === 3 ? at(1.5) : S16 * 0.95, 0.15, (k - 1.5) * 0.3));
sparkle(at(46));
for (let b = 46; b < 50; b++) { kick(at(b), 0.8); hat(at(b + 0.5), 0.1, true, -0.3); if (b % 2) clap(at(b), 0.45); }
[0, 12, 0, 12, 0, 12, 7, 12, 0, 12, 0, 12, 0, 12, 7, 12].forEach((o, k) => bass(at(46) + k * 2 * S16, 43 + o, S16 * 1.6, 0.34, main));
pad(at(46), [55, 59, 62, 67], at(5), 0.05);
kick(at(50), 1); crash(at(50), 0.3, 1.6); stab(at(50), [55, 59, 62, 67, 71], 0.9, 0.09, main);

// ---------------------------------------------------------------- mix
// the groove bus: muffled under the replies, opening up into the question; everywhere else straight through
{
  const s5 = at(5) * SR, s10 = at(10.4) * SR;
  let l = 0, r = 0;
  for (let i = 0; i < N; i++) {
    if (i < s5 || i > s10) { main.L[i] += groove.L[i]; main.R[i] += groove.R[i]; l = groove.L[i]; r = groove.R[i]; continue; }
    const p = (i - s5) / (s10 - s5), a = lpA(450 * 2 ** (p * 4.3));
    l += a * (groove.L[i] - l); r += a * (groove.R[i] - r);
    main.L[i] += l * (0.75 + 0.25 * p); main.R[i] += r * (0.75 + 0.25 * p);
  }
}
// a ping-pong echo, dotted eighth
{
  const d = Math.round(B * 0.75 * SR);
  for (let i = d; i < N; i++) { echo.L[i] += echo.R[i - d] * 0.38; echo.R[i] += echo.L[i - d] * 0.38; }
  for (let i = 0; i < N; i++) { main.L[i] += echo.L[i] * 0.55; main.R[i] += echo.R[i] * 0.55; }
}
// a small room: four combs and two allpasses (Schroeder)
for (const ch of ['L', 'R']) {
  const x = send[ch], y = new Float32Array(N);
  const off = ch === 'L' ? 0 : 23;
  for (const dl of [1557, 1617, 1491, 1422].map((v) => v + off)) {
    const buf = new Float32Array(dl); let k = 0, lp = 0;
    for (let i = 0; i < N; i++) { const o = buf[k]; lp += 0.45 * (o - lp); buf[k] = x[i] + lp * 0.8; y[i] += o * 0.25; k = (k + 1) % dl; }
  }
  for (const dl of [225, 556].map((v) => v + off)) {
    const buf = new Float32Array(dl); let k = 0;
    for (let i = 0; i < N; i++) { const b = buf[k], v = y[i] + b * 0.5; buf[k] = v; y[i] = b - v * 0.5; k = (k + 1) % dl; }
  }
  for (let i = 0; i < N; i++) main[ch][i] += y[i] * 0.6;
}
// master: a gentle soft clip, normalized; loudness is set by ffmpeg below
let peak = 0;
for (let i = 0; i < N; i++) { main.L[i] = Math.tanh(main.L[i] * 1.1); main.R[i] = Math.tanh(main.R[i] * 1.1); peak = Math.max(peak, Math.abs(main.L[i]), Math.abs(main.R[i])); }
const gain = 0.92 / (peak || 1);

// a 16-bit stereo WAV
const wav = Buffer.alloc(44 + N * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, main.L[i] * gain)) * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, main.R[i] * gain)) * 32767), 46 + i * 4);
}
writeFileSync('brand/warmup-music.wav', wav);
console.log(`brand/warmup-music.wav (${TOTAL.toFixed(2)} s at ${(60 / B).toFixed(2)} bpm)`);

// onto the video: social-media loudness (about -15 LUFS), a short fade at the end. The limit is low because AAC overshoots
// this mix's sharp transients by ~5 dB; with a 15 kHz top and the limit at -4 dB the encoded peaks land near -2 dBFS
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'brand/warmup-ad.mp4', '-i', 'brand/warmup-music.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
  '-af', `afade=t=out:st=${(TOTAL - 0.5).toFixed(3)}:d=0.5,lowpass=f=15000,loudnorm=I=-15:TP=-3:LRA=9,aresample=44100,alimiter=limit=0.63:level=disabled`, '-c:a', 'aac', '-b:a', '256k', '-ar', '44100', '-shortest', '-movflags', '+faststart', 'brand/warmup-ad-music.mp4']);
console.log('brand/warmup-ad-music.mp4');
