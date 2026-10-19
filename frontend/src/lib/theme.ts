import { useEffect, useState } from 'react';

type Mode = 'dark' | 'light';

/** Light / dark only — the accent is fixed (reference butter theme). */
export function useTheme() {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('sam.theme') as Mode) ?? 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.setAttribute('data-accent', 'butter');
    localStorage.setItem('sam.theme', mode);
  }, [mode]);

  return {
    mode,
    toggleMode: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
  };
}
