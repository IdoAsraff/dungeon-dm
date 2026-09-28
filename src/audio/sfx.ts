/**
 * Sound effects, synthesized with the Web Audio API (no audio files):
 *
 *   reveal  – a deep, slow, mysterious swell with a faint shimmer
 *   handout – the same family, brighter and shorter: a page-like rustle into a soft chime
 *   ping    – a very soft, low tick, like a single footstep
 */
export type SfxKind = "reveal" | "handout" | "ping";

let ctx: AudioContext | null = null;
let reverbBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Browsers only allow audio after a user gesture: unlock on the first click/key. */
export function unlockAudioOnGesture() {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** A soft synthetic room reverb (decaying stereo noise). */
function reverb(ac: AudioContext): ConvolverNode {
  if (!reverbBuffer) {
    const seconds = 3.2;
    const len = Math.floor(ac.sampleRate * seconds);
    reverbBuffer = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = reverbBuffer.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
  }
  const conv = ac.createConvolver();
  conv.buffer = reverbBuffer;
  return conv;
}

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Gain envelope: 0 → peak over `attack`, then exponential fall to silence by `end`. */
function envelope(g: GainNode, t0: number, peak: number, attack: number, end: number) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
}

function tone(ac: AudioContext, dest: AudioNode, t0: number, freq: number, type: OscillatorType, peak: number, attack: number, end: number, detune = 0) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.detune.setValueAtTime(detune, t0);
  const g = ac.createGain();
  envelope(g, t0, peak, attack, end);
  o.connect(g).connect(dest);
  o.start(t0);
  o.stop(t0 + end + 0.05);
  return o;
}

function reveal(ac: AudioContext, out: GainNode) {
  const t0 = ac.currentTime + 0.02;
  const wet = ac.createGain();
  wet.gain.value = 0.55;
  const rv = reverb(ac);
  rv.connect(wet).connect(out);
  const bus = ac.createGain();
  bus.connect(out);
  bus.connect(rv);

  // Deep swell: low fifth (A1 + E2) with slow attack, warmed by a low-pass.
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(180, t0);
  lp.frequency.exponentialRampToValueAtTime(700, t0 + 1.2);
  lp.frequency.exponentialRampToValueAtTime(200, t0 + 3);
  lp.connect(bus);
  tone(ac, lp, t0, 55, "sawtooth", 0.16, 0.9, 3.2, -6);
  tone(ac, lp, t0, 55, "sawtooth", 0.16, 0.9, 3.2, 7);
  tone(ac, lp, t0, 82.41, "triangle", 0.2, 1.1, 3.0);

  // Airy breath: band-passed noise sweeping upwards.
  const n = ac.createBufferSource();
  n.buffer = noiseBuffer(ac, 3);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(250, t0);
  bp.frequency.exponentialRampToValueAtTime(1600, t0 + 2.2);
  const ng = ac.createGain();
  envelope(ng, t0, 0.05, 1.0, 2.6);
  n.connect(bp).connect(ng).connect(bus);
  n.start(t0);
  n.stop(t0 + 3);

  // Faint shimmer arriving after the swell (an open, slightly mysterious chord).
  for (const [f, delay] of [
    [880, 0.55],
    [1318.5, 0.75],
    [1864.7, 0.95],
  ] as const) {
    const o = tone(ac, bus, t0 + delay, f, "sine", 0.018, 0.5, 2.4);
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    lfo.frequency.value = 5.2;
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(o.detune);
    lfo.start(t0 + delay);
    lfo.stop(t0 + delay + 2.5);
  }
}

function handout(ac: AudioContext, out: GainNode) {
  const t0 = ac.currentTime + 0.02;
  const wet = ac.createGain();
  wet.gain.value = 0.45;
  const rv = reverb(ac);
  rv.connect(wet).connect(out);
  const bus = ac.createGain();
  bus.connect(out);
  bus.connect(rv);

  // Paper-like rustle: short high band-passed noise.
  const n = ac.createBufferSource();
  n.buffer = noiseBuffer(ac, 0.5);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(2600, t0);
  bp.frequency.exponentialRampToValueAtTime(4200, t0 + 0.3);
  const ng = ac.createGain();
  envelope(ng, t0, 0.06, 0.04, 0.35);
  n.connect(bp).connect(ng).connect(bus);
  n.start(t0);
  n.stop(t0 + 0.5);

  // Soft low bed (same family as the reveal, shorter).
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;
  lp.connect(bus);
  tone(ac, lp, t0, 110, "triangle", 0.1, 0.25, 1.4);

  // Chime: a bright open fifth with a gentle octave on top.
  tone(ac, bus, t0 + 0.12, 659.25, "sine", 0.07, 0.01, 1.6);
  tone(ac, bus, t0 + 0.16, 987.77, "sine", 0.05, 0.01, 1.4);
  tone(ac, bus, t0 + 0.2, 1318.5, "sine", 0.025, 0.01, 1.1);
}

function ping(ac: AudioContext, out: GainNode) {
  const t0 = ac.currentTime + 0.01;
  // A single soft, low footstep-like tick.
  const n = ac.createBufferSource();
  n.buffer = noiseBuffer(ac, 0.12);
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 650;
  const ng = ac.createGain();
  envelope(ng, t0, 0.09, 0.004, 0.08);
  n.connect(lp).connect(ng).connect(out);
  n.start(t0);
  n.stop(t0 + 0.12);
  tone(ac, out, t0, 95, "sine", 0.07, 0.004, 0.1);
}

/** Plays a sound effect at `volume` (0–1). Safe to call when audio is unavailable. */
export function playSfx(kind: SfxKind, volume: number) {
  const ac = audio();
  if (!ac || volume <= 0) return;
  const out = ac.createGain();
  out.gain.value = Math.min(1, Math.max(0, volume));
  out.connect(ac.destination);
  if (kind === "reveal") reveal(ac, out);
  else if (kind === "handout") handout(ac, out);
  else ping(ac, out);
  setTimeout(() => out.disconnect(), 5000);
}
