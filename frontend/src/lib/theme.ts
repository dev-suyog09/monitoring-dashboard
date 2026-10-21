import { useCallback, useEffect, useState } from 'react';
import { smooth } from './transition';

/**
 * dark    AMOLED black            light   Purple admin
 * calm    soft slate-blue         aurora  deep indigo with violet + teal glow
 * emerald dark forest green       sunset  warm cream with orange accents
 */
export type Mode = 'dark' | 'light' | 'calm' | 'aurora' | 'emerald' | 'sunset';

export const THEMES: { id: Mode; label: string; blurb: string; dark: boolean; swatch: [string, string, string] }[] = [
  { id: 'dark', label: 'AMOLED', blurb: 'Pure black', dark: true, swatch: ['#000000', '#101011', '#60a5fa'] },
  { id: 'calm', label: 'Calm', blurb: 'Soft slate-blue', dark: true, swatch: ['#181b29', '#212539', '#5b86ff'] },
  { id: 'aurora', label: 'Aurora', blurb: 'Indigo, violet and teal', dark: true, swatch: ['#120f2b', '#1c1840', '#a78bfa'] },
  { id: 'emerald', label: 'Emerald', blurb: 'Deep forest green', dark: true, swatch: ['#08130f', '#0f2019', '#34d399'] },
  { id: 'light', label: 'Light', blurb: 'Purple admin', dark: false, swatch: ['#f1edf7', '#ffffff', '#a05aff'] },
  { id: 'sunset', label: 'Sunset', blurb: 'Warm cream and orange', dark: false, swatch: ['#fbf3ea', '#ffffff', '#f97316'] },
];

export const MODE_LABEL = Object.fromEntries(THEMES.map((t) => [t.id, t.label])) as Record<Mode, string>;
const IDS = THEMES.map((t) => t.id);

function load(): Mode {
  try {
    const v = localStorage.getItem('sam.theme') as Mode | null;
    return v && IDS.includes(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * Structure vs palette: AMOLED is `data-theme="dark"`; the soft dark themes reuse that structure with
 * `data-tone="calm"` plus a `data-palette`; light themes are `data-theme="light"` (sunset adds its palette).
 */
export function applyMode(mode: Mode): void {
  const root = document.documentElement;
  const light = mode === 'light' || mode === 'sunset';
  root.setAttribute('data-theme', light ? 'light' : 'dark');
  if (mode === 'calm' || mode === 'aurora' || mode === 'emerald') root.setAttribute('data-tone', 'calm');
  else root.removeAttribute('data-tone');
  if (mode === 'dark' || mode === 'light') root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', mode);
  root.setAttribute('data-accent', 'butter');
}

// applied before the first paint so the saved theme never flashes the default one
if (typeof document !== 'undefined') applyMode(load());

export function useTheme() {
  const [mode, setModeState] = useState<Mode>(load);

  useEffect(() => {
    applyMode(mode);
    try {
      localStorage.setItem('sam.theme', mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  // a theme picked in another open tab applies here as well
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sam.theme' || e.key === null) setModeState(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // changing theme cross-fades the whole page; the attributes are set inside the transition so both frames are right
  const setMode = useCallback(
    (m: Mode) =>
      smooth(() => {
        applyMode(m);
        setModeState(m);
      }),
    [],
  );
  const next = IDS[(IDS.indexOf(mode) + 1) % IDS.length]!;
  return { mode, next, setMode, toggleMode: () => setMode(next) };
}
