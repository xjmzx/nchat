// Audible feedback for messages arriving and leaving.
//
// The tones are synthesised with WebAudio rather than shipped as audio files.
// That keeps binary assets out of the bundle and, more to the point, keeps the
// CSP alone: `default-src 'self'` needs no `media-src` exception for a sound
// that is generated in the page rather than fetched.
//
// The AudioContext is created once and reused. Creating one per blip leaks
// contexts and browsers cap how many a page may hold.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    // Autoplay policy parks a context constructed before any user gesture.
    // Resuming is a no-op once the user has clicked anything.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    // No audio device — a headless session, or a Linux box with no working
    // sound server. Silence is the correct outcome, never an error.
    return null;
  }
}

/** One short sine tone. `offset` is seconds from now, `peak` a 0..1 gain. */
function blip(
  c: AudioContext,
  freq: number,
  offset: number,
  ms: number,
  peak: number,
): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;

  const t0 = c.currentTime + offset;
  const t1 = t0 + ms / 1000;
  // Ramped rather than switched: a square-edged gain change is audible as a
  // click, which reads as a glitch rather than as a notification.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** A new message arrived: two rising tones, the more attention-seeking pair. */
export function playReceive(): void {
  const c = context();
  if (!c) return;
  blip(c, 660, 0, 90, 0.06);
  blip(c, 880, 0.085, 120, 0.06);
}

/** A message went out: one short, quieter tone. Confirmation, not an alert. */
export function playSent(): void {
  const c = context();
  if (!c) return;
  blip(c, 520, 0, 70, 0.035);
}
