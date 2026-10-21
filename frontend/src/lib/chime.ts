import { getSettings } from './settings';

/**
 * Alert tunes, all synthesised with the Web Audio API (nothing to download). Browsers only allow audio after the
 * user has interacted with the page, so `unlockAudio()` is called on clicks / key presses; until then alerts stay
 * silent (the pop-up still shows).
 */

/** One note: [frequency Hz, start offset s, length s, peak gain]. */
type Note = [number, number, number, number];

interface TuneDef {
  id: string;
  label: string;
  blurb: string;
  wave: OscillatorType;
  /** Add a quiet octave above each note (a shimmer). */
  shimmer?: boolean;
  /** Tiny upward "bloop" into each pitch. */
  bloop?: boolean;
  notes: Note[];
}

export const TUNES: TuneDef[] = [
  {
    id: 'bubble', label: 'Bu-bling', blurb: 'Soft, bubbly three notes', wave: 'triangle', shimmer: true, bloop: true,
    notes: [[784.0, 0.0, 0.42, 0.2], [1046.5, 0.12, 0.42, 0.22], [1318.5, 0.24, 0.42, 0.24], [2637.0, 0.36, 0.42, 0.07]],
  },
  {
    id: 'crystal', label: 'Crystal', blurb: 'Glassy rising sparkle', wave: 'sine', shimmer: true,
    notes: [[1046.5, 0.0, 0.6, 0.16], [1318.5, 0.09, 0.6, 0.16], [1568.0, 0.18, 0.6, 0.16], [2093.0, 0.27, 0.9, 0.18]],
  },
  {
    id: 'marimba', label: 'Marimba', blurb: 'Warm wooden mallet', wave: 'triangle',
    notes: [[523.25, 0.0, 0.32, 0.3], [659.25, 0.13, 0.32, 0.3], [783.99, 0.26, 0.32, 0.3], [659.25, 0.39, 0.45, 0.26]],
  },
  {
    id: 'harp', label: 'Harp', blurb: 'Plucked ascending strings', wave: 'triangle', shimmer: true,
    notes: [[392.0, 0.0, 0.9, 0.17], [523.25, 0.08, 0.9, 0.17], [659.25, 0.16, 0.9, 0.17], [783.99, 0.24, 0.9, 0.17], [1046.5, 0.32, 1.1, 0.17]],
  },
  {
    id: 'zen', label: 'Zen bowl', blurb: 'One calm, resonant tone', wave: 'sine', shimmer: true,
    notes: [[261.63, 0.0, 1.8, 0.3], [392.0, 0.04, 1.6, 0.14]],
  },
  {
    id: 'ping', label: 'Digital ping', blurb: 'Crisp double blip', wave: 'sine',
    notes: [[1568.0, 0.0, 0.18, 0.22], [2093.0, 0.14, 0.3, 0.24]],
  },
  {
    id: 'arcade', label: 'Arcade', blurb: 'Retro 8-bit power-up', wave: 'square',
    notes: [[523.25, 0.0, 0.11, 0.07], [659.25, 0.08, 0.11, 0.07], [783.99, 0.16, 0.11, 0.07], [1046.5, 0.24, 0.3, 0.08]],
  },
  {
    id: 'headsup', label: 'Heads up', blurb: 'Falling tone, gets attention', wave: 'triangle',
    notes: [[1318.5, 0.0, 0.28, 0.26], [1046.5, 0.22, 0.28, 0.26], [880.0, 0.44, 0.5, 0.28]],
  },
  {
    id: 'pulse', label: 'Alert pulse', blurb: 'Urgent triple beep', wave: 'sawtooth',
    notes: [[880.0, 0.0, 0.14, 0.09], [660.0, 0.16, 0.14, 0.09], [880.0, 0.36, 0.14, 0.09], [660.0, 0.52, 0.14, 0.09], [880.0, 0.72, 0.14, 0.09], [660.0, 0.88, 0.22, 0.09]],
  },
];

const byId = (id: string): TuneDef => TUNES.find((t) => t.id === id) ?? TUNES[0]!;

/** Schedule a tune on any audio context. Returns its length in seconds. */
export function scheduleTune(ctx: BaseAudioContext, destination: AudioNode, t0: number, id: string): number {
  const tune = byId(id);
  let end = 0;
  for (const [freq, offset, len, peak] of tune.notes) {
    const start = t0 + offset;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012); // soft click-free attack
    gain.gain.exponentialRampToValueAtTime(0.0001, start + len); // decay
    gain.connect(destination);

    const body = ctx.createOscillator();
    body.type = tune.wave;
    if (tune.bloop) {
      body.frequency.setValueAtTime(freq * 0.97, start);
      body.frequency.exponentialRampToValueAtTime(freq, start + 0.05);
    } else {
      body.frequency.setValueAtTime(freq, start);
    }
    body.connect(gain);
    body.start(start);
    body.stop(start + len + 0.03);

    if (tune.shimmer) {
      const sh = ctx.createOscillator();
      sh.type = 'sine';
      sh.frequency.setValueAtTime(freq * 2, start);
      const shGain = ctx.createGain();
      shGain.gain.value = 0.28;
      sh.connect(shGain).connect(gain);
      sh.start(start);
      sh.stop(start + Math.min(len, 0.5));
    }
    end = Math.max(end, offset + len);
  }
  return end;
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

/** Play a tune now (defaults: the tune and volume chosen in Settings). Returns false when the browser hasn't allowed audio yet. */
export function playChime(id?: string, volume?: number): boolean {
  try {
    unlockAudio();
    const c = ctx;
    if (!c) return false;
    const s = getSettings();
    const tune = id ?? s.tune;
    const vol = Math.max(0, Math.min(100, volume ?? s.volume)) / 100;
    const play = () => {
      const master = c.createGain();
      master.gain.value = vol;
      master.connect(c.destination);
      scheduleTune(c, master, c.currentTime + 0.02, tune);
    };
    if (c.state === 'running') {
      play();
      return true;
    }
    // suspended (e.g. after the tab sat idle): wake it and play as soon as it is running
    void c.resume().then(() => c.state === 'running' && play()).catch(() => undefined);
    return false;
  } catch {
    return false;
  }
}
