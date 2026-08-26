// Audible feedback for messages arriving and leaving.
//
// Played through an HTMLMediaElement, not Web Audio, and that is not a style
// choice: Web Audio output is broken on WebKit2GTK, the Linux stack this suite
// targets. The audio thread emits frames that never reach the sound card — no
// error, just silence — and no amount of keep-alive or user-gesture timing
// fixes it. `nsmpl` hit it on region loops and `ntree` on clip preview; both
// landed on HTMLMediaElement, and SUITE.md records it as a suite convention.
// A first cut of this file used an AudioContext and was silent on Linux while
// working on macOS, which is exactly the shape of that bug.
//
// The tones are still synthesised rather than shipped as .wav files — a WAV is
// assembled in memory at first use and handed over as a blob URL. No binary
// assets in the repo, and the only CSP concession is `media-src blob:`.
//
// The element is created once per tone and reused. Creating a fresh Audio()
// per play is the other thing WebKit2GTK dislikes (see ntree's clip preview).

const SAMPLE_RATE = 44100;

interface Tone {
  freq: number;
  /** Offset from the start of the clip. */
  startMs: number;
  ms: number;
  /** 0..1. Baked into the samples, so element volume stays at 1. */
  peak: number;
}

/** Sum the tones into one mono buffer. */
function render(tones: Tone[]): Float32Array {
  const totalMs = Math.max(...tones.map((t) => t.startMs + t.ms)) + 20;
  const samples = new Float32Array(Math.ceil((totalMs / 1000) * SAMPLE_RATE));

  for (const tone of tones) {
    const start = Math.floor((tone.startMs / 1000) * SAMPLE_RATE);
    const len = Math.floor((tone.ms / 1000) * SAMPLE_RATE);
    // Ramp in and out. A square-edged start or stop is audible as a click,
    // which reads as a glitch rather than as a notification.
    const attack = Math.min(Math.floor(0.012 * SAMPLE_RATE), Math.floor(len / 2));

    for (let i = 0; i < len; i++) {
      const at = start + i;
      if (at >= samples.length) break;
      const env = i < attack ? i / attack : 1 - (i - attack) / (len - attack);
      samples[at] += Math.sin(2 * Math.PI * tone.freq * (i / SAMPLE_RATE)) * env * tone.peak;
    }
  }
  return samples;
}

/** Wrap mono float samples in a 16-bit PCM WAV container. */
function wav(samples: Float32Array): Blob {
  const bytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const view = new DataView(buf);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, bytes, true);

  let at = 44;
  for (let i = 0; i < samples.length; i++, at += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Built on first play and kept for the life of the window. */
function player(cache: { el: HTMLAudioElement | null }, tones: Tone[]): HTMLAudioElement {
  if (!cache.el) {
    cache.el = new Audio(URL.createObjectURL(wav(render(tones))));
    cache.el.preload = "auto";
  }
  return cache.el;
}

function play(el: HTMLAudioElement): void {
  try {
    el.currentTime = 0;
    // Autoplay policy can reject this outright. A missed notification tone is
    // never worth surfacing as an error.
    void el.play().catch(() => {});
  } catch {
    /* No audio device, or the element is in a state that refuses seeking. */
  }
}

const receiveEl: { el: HTMLAudioElement | null } = { el: null };
const sentEl: { el: HTMLAudioElement | null } = { el: null };

/** A new message arrived: two rising tones, the more attention-seeking pair. */
export function playReceive(): void {
  play(
    player(receiveEl, [
      { freq: 660, startMs: 0, ms: 90, peak: 0.25 },
      { freq: 880, startMs: 85, ms: 120, peak: 0.25 },
    ]),
  );
}

/** A message went out: one short, quieter tone. Confirmation, not an alert. */
export function playSent(): void {
  play(player(sentEl, [{ freq: 520, startMs: 0, ms: 70, peak: 0.15 }]));
}
