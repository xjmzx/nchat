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
//
// There is a SECOND Linux wall behind the Web Audio one, and it is the reason
// tones were silent here long after the switch to HTMLMediaElement: WebKitGTK
// grants only *transient* user activation. A play() more than a few seconds
// after the last click is refused with NotAllowedError — which is every tone
// this app has, since the send tone waits on a relay round trip and the
// receive tone fires from a sync timer. macOS does not enforce this, so the
// bug is invisible there. `unlockTones()` below is the standard answer: start
// and immediately stop each element inside a real gesture, after which that
// element may be played programmatically for the life of the page. Measured
// on WebKit2GTK 4.1: an unlocked element resolves after a 10s idle while an
// identical un-unlocked one rejects.

const SAMPLE_RATE = 44100;

interface Tone {
  freq: number;
  /** Offset from the start of the clip. */
  startMs: number;
  ms: number;
  /** 0..1, the INTENDED loudness. Not baked in at this level — see player(). */
  peak: number;
}

/** Samples are baked close to full scale and the intended level is applied at
 *  the element instead. That is not a stylistic choice either: WebKitGTK pins
 *  media-element volume at roughly 0.1 and overwrites whatever the page sets,
 *  while macOS leaves it at 1. Baking the intended level into the samples
 *  therefore lands ~20dB quieter on Linux than on macOS — measured here as
 *  completely inaudible while macOS was fine. Baking loud and asking for a
 *  quiet element gives macOS exactly the level it always had, and lets the
 *  Linux override work in our favour rather than against us. */
const FULL_SCALE = 0.92;

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
    const samples = render(tones);
    // Normalise to near full scale, then hand the level the tones actually
    // asked for to the element. Relative shape is untouched.
    let loudest = 0;
    for (const s of samples) loudest = Math.max(loudest, Math.abs(s));
    if (loudest > 0) {
      const lift = FULL_SCALE / loudest;
      for (let i = 0; i < samples.length; i++) samples[i] *= lift;
    }
    cache.el = new Audio(URL.createObjectURL(wav(samples)));
    cache.el.preload = "auto";
    cache.el.volume = Math.min(1, loudest);
  }
  return cache.el;
}

/** Told why a tone did not play, when anyone is listening. */
let report: ((why: string) => void) | null = null;

/** Register a sink for tone failures. A missed notification is not worth an
 *  error dialog, but discarding the reason outright makes a silent tone
 *  undiagnosable from outside the webview — which is exactly how the Linux
 *  case stayed hidden. */
export function onToneFailure(fn: ((why: string) => void) | null): void {
  report = fn;
}

function play(el: HTMLAudioElement): void {
  try {
    el.currentTime = 0;
    // Autoplay policy can reject this outright, and on WebKit2GTK a resolved
    // promise still does not guarantee audible output — so record both the
    // rejection and what the element thought it was doing.
    void el
      .play()
      .catch((e: unknown) => {
        const err = e as { name?: string; message?: string };
        report?.(`play() rejected: ${err.name ?? "Error"} — ${err.message ?? ""}`);
      });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    report?.(`currentTime seek threw: ${err.name ?? "Error"} — play() never called`);
  }
}

const receiveEl: { el: HTMLAudioElement | null } = { el: null };
const sentEl: { el: HTMLAudioElement | null } = { el: null };

/** Bless both tone elements inside a user gesture so later, gesture-less
 *  plays are allowed. Safe to call more than once; harmless where the platform
 *  does not require it. MUST be called synchronously from a real user event —
 *  an await beforehand loses the activation and defeats the whole point. */
export function unlockTones(): void {
  for (const el of [receive(), sent()]) {
    void el
      .play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
      })
      .catch(() => {
        /* Nothing to do: the tone simply stays blocked, as it was before. */
      });
  }
}

/** A new message arrived: two rising tones, the more attention-seeking pair. */
function receive(): HTMLAudioElement {
  return player(receiveEl, [
    { freq: 660, startMs: 0, ms: 90, peak: 0.25 },
    { freq: 880, startMs: 85, ms: 120, peak: 0.25 },
  ]);
}

export function playReceive(): void {
  play(receive());
}

/** A message went out: one short, quieter tone. Confirmation, not an alert. */
function sent(): HTMLAudioElement {
  return player(sentEl, [{ freq: 520, startMs: 0, ms: 70, peak: 0.15 }]);
}

export function playSent(): void {
  play(sent());
}
