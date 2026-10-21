import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotsResponse } from '../types';
import { diffAlerts, loadAlerts, loadDesktopPref, loadSoundPref, saveAlerts, saveDesktopPref, saveSoundPref, type AlertItem } from './alerts';
import { playChime } from './chime';

export interface Toast {
  id: string;
  title: string;
  body: string;
}

const MAX_TOASTS_PER_CHECK = 3;

/** Watches the bot instances; raises a bell entry + toast when one newly goes Stopped / Unresponsive. */
export function useAlerts(data: BotsResponse | null) {
  const initial = useRef(loadAlerts());
  const [items, setItems] = useState<AlertItem[]>(initial.current.items);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const redRef = useRef<Record<string, string>>(initial.current.red);
  const [sound, setSound] = useState(loadSoundPref);
  const [desktop, setDesktop] = useState(() => loadDesktopPref() && typeof Notification !== 'undefined' && Notification.permission === 'granted');

  useEffect(() => {
    // Nothing has been checked yet (inventory only) -> nothing to compare.
    if (!data || !data.cloudServices.some((s) => s.checkedAt)) return;
    const { red, created } = diffAlerts(redRef.current, data.instances, data.cloudServices, new Date().toISOString());
    const changed = created.length > 0 || JSON.stringify(red) !== JSON.stringify(redRef.current);
    redRef.current = red;
    if (!changed) return;

    setItems((prev) => {
      const next = [...created, ...prev].slice(0, 60);
      saveAlerts({ items: next, red });
      return next;
    });

    const downs = created.filter((c) => c.kind === 'down');
    if (downs.length === 0) return;
    const fresh: Toast[] =
      downs.length <= MAX_TOASTS_PER_CHECK
        ? downs.map((d) => ({
            id: d.id,
            title: `Instance ${d.status.toLowerCase()}`,
            body: `${d.instance.split('.').pop()} · ${d.cloudService}`,
          }))
        : [
            {
              id: `${downs[0]!.id}|batch`,
              title: `${downs.length} instances stopped / unresponsive`,
              body: downs
                .slice(0, 3)
                .map((d) => d.cloudService)
                .join(', ') + ` +${downs.length - 3} more`,
            },
          ];
    setToasts((t) => [...t, ...fresh].slice(-5));
    if (sound) playChime(); // cute "bu-bling" (silent until the page has had a click / key press)

    if (desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification('NTR-X Azure Dashboard', {
          body: fresh.map((f) => `${f.title}: ${f.body}`).join('\n'),
          tag: 'godzilla-instance-down',
        });
      } catch {
        /* some webviews block the constructor — the in-page toast still shows */
      }
    }
  }, [data, desktop, sound]);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const persist = (next: AlertItem[]) => saveAlerts({ items: next, red: redRef.current });
  const markAllRead = useCallback(() => {
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, read: true }));
      persist(next);
      return next;
    });
  }, []);
  const markRead = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, read: true } : i));
      persist(next);
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    setItems([]);
    persist([]);
  }, []);

  /** Ask the browser for permission once; afterwards alerts also appear as desktop notifications while the tab is hidden. */
  const enableDesktop = useCallback(async () => {
    if (typeof Notification === 'undefined') return false;
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    const on = perm === 'granted';
    setDesktop(on);
    saveDesktopPref(on);
    return on;
  }, []);
  const toggleSound = useCallback((on: boolean) => {
    setSound(on);
    saveSoundPref(on);
  }, []);
  const disableDesktop = useCallback(() => {
    setDesktop(false);
    saveDesktopPref(false);
  }, []);

  return {
    items,
    unread: items.filter((i) => !i.read && i.kind === 'down').length,
    toasts,
    dismissToast,
    markAllRead,
    markRead,
    clear,
    sound,
    toggleSound,
    previewSound: playChime,
    desktop,
    desktopSupported: typeof Notification !== 'undefined',
    enableDesktop,
    disableDesktop,
  };
}
