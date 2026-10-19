/**
 * The alert tone: a soft, bubbly three-note "bu-bling" (G5 → C6 → E6) with a little sparkle on top, synthesised with
 * the Web Audio API — no sound file to ship. Browsers only allow audio after the user has interacted with the page, so
 * `unlockAudio()` is called on the first click / key press; until then alerts stay silent (the toast still shows).
 */

/** Notes: [frequency Hz, start offset s, peak gain]. */
const NOTES: Array<[number, number, number]> = [
  [784.0, 0.0, 0.2], // G5
  [1046.5, 0.12, 0.22], // C6
  [1318.5, 0.24, 0.24], // E6
  [2637.0, 0.36, 0.07], // E7 sparkle
];

/** Schedule the chime on any audio context (a real one, or an offline one for tests). Returns its length in seconds. */
export function scheduleChime(ctx: BaseAudioContext, destination: AudioNode, t0 = 0): number {
  for (const [freq, offset, peak] of NOTES) {
    const start = t0 + offset;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012); // soft click-free attack
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42); // bell-like decay
    gain.connect(destination);

    const body = ctx.createOscillator(); // warm fundamental
    body.type = 'triangle';
    body.frequency.setValueAtTime(freq * 0.97, start); // a tiny upward "bloop" into the pitch
    body.frequency.exponentialRampToValueAtTime(freq, start + 0.05);
    body.connect(gain);
    body.start(start);
    body.stop(start + 0.45);

    const shimmer = ctx.createOscillator(); // quiet octave for the sparkle
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(freq * 2, start);
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.28;
    shimmer.connect(shimmerGain).connect(gain);
    shimmer.start(start);
    shimmer.stop(start + 0.3);
  }
  return NOTES[NOTES.length - 1]![1] + 0.45;
}

let ctx: AudioContext | null = null;

const AudioCtor = (): typeof AudioContext | undefined =>
  typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

/** Call from a user gesture (click / key press) so later alerts are allowed to make sound. */
export function unlockAudio(): void {
  try {
    const Ctor = AudioCtor();
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* audio unavailable — alerts stay silent */
  }
}

/** Play the chime now. Returns false when the browser hasn't allowed audio yet. */
export function playChime(): boolean {
  try {
    unlockAudio();
    if (!ctx || ctx.state !== 'running') return false;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    scheduleChime(ctx, master, ctx.currentTime + 0.02);
    return true;
  } catch {
    return false;
  }
}
