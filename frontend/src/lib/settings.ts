import { useEffect, useSyncExternalStore } from 'react';

/** Everything the Settings panel can change. Stored in this browser only (localStorage `sam.settings`). */
export interface Settings {
  /** pinned = always visible, hidden = off until the ☰ button is pressed, hover = slides out from the left edge. */
  sidebar: 'pinned' | 'hidden' | 'hover';
  density: 'comfortable' | 'compact';
  /** Accent colour override ('' = the theme's own). */
  accent: string;
  reduceMotion: boolean;
  /** Minutes between automatic re-checks (0 = off). */
  autoMinutes: number;
  /** Open the "charts" section automatically on every tab. */
  autoCharts: boolean;
  defaultTab: 'customers' | 'archive' | 'bots' | 'dbs';
  greeting: boolean;
  /** Solid 3D charts (exploded pie, raised bars, ribbon). Off = flat charts. */
  charts3d: boolean;
  /** Alert tune id (see TUNES in chime.ts) and its volume, 0-100. */
  tune: string;
  volume: number;
}

export const DEFAULTS: Settings = {
  sidebar: 'pinned',
  density: 'comfortable',
  accent: '',
  reduceMotion: false,
  autoMinutes: 15,
  autoCharts: false,
  defaultTab: 'customers',
  greeting: true,
  charts3d: false,
  tune: 'bubble',
  volume: 80,
};

/** "every 5 min" / "every hour" / "off" for the Auto re-check setting. */
export function everyLabel(minutes: number, long = false): string {
  if (minutes <= 0) return 'off';
  if (minutes === 60) return 'every hour';
  return `every ${minutes} ${long ? 'minutes' : 'min'}`;
}

export const ACCENTS: { id: string; label: string; a: string; b: string }[] = [
  { id: '', label: 'Theme default', a: '', b: '' },
  { id: 'blue', label: 'Blue', a: '#4f8cff', b: '#2f6bf0' },
  { id: 'violet', label: 'Violet', a: '#9b6bff', b: '#7c3aed' },
  { id: 'teal', label: 'Teal', a: '#2dd4bf', b: '#0d9488' },
  { id: 'emerald', label: 'Emerald', a: '#34d399', b: '#059669' },
  { id: 'amber', label: 'Amber', a: '#fbbf24', b: '#d97706' },
  { id: 'rose', label: 'Rose', a: '#fb7185', b: '#e11d48' },
];

const KEY = 'sam.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: settings still apply for this session */
  }
  emit();
}

export function resetSettings(): void {
  current = DEFAULTS;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export const getSettings = (): Settings => current;

/** Live settings: any component using this re-renders when one changes. */
export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Mirrors the settings onto <html> so plain CSS can react to them. */
function applyToDom(s: Settings): void {
  const root = document.documentElement;
  root.setAttribute('data-sidebar', s.sidebar);
  root.setAttribute('data-density', s.density);
  root.setAttribute('data-charts', s.charts3d ? '3d' : 'flat');
  root.setAttribute('data-motion', s.reduceMotion ? 'reduced' : 'full');
  const acc = ACCENTS.find((a) => a.id === s.accent);
  if (acc && acc.a) {
    root.style.setProperty('--accent', acc.a);
    root.style.setProperty('--accent-2', acc.b);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-2');
  }
}

// applied before the first paint, so a hidden sidebar (or a saved accent) never flashes the default look
if (typeof document !== 'undefined') applyToDom(current);

// another tab of the dashboard changed a setting (e.g. the alert tune): pick it up here too, without a reload
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    applyToDom(current);
    emit();
  });
}

/** Keeps <html> in step with the settings. Call once, near the top of the app. */
export function useApplySettings(s: Settings): void {
  useEffect(() => {
    applyToDom(s);
  }, [s.sidebar, s.density, s.reduceMotion, s.accent, s.charts3d]); // eslint-disable-line react-hooks/exhaustive-deps
}
