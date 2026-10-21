import { flushSync } from 'react-dom';

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

/**
 * Runs a state change inside a browser View Transition, so switching tabs or themes cross-fades smoothly instead of
 * snapping. Browsers without the API (and "reduce motion") just apply the change immediately.
 */
export function smooth(change: () => void): void {
  const doc = document as VTDocument;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced';
  if (!doc.startViewTransition || reduced) {
    change();
    return;
  }
  const root = document.documentElement;
  root.classList.add('vt'); // while this runs, the per-item entry animations stay off so nothing animates twice
  const t = doc.startViewTransition(() => flushSync(change));
  void t.finished.finally(() => root.classList.remove('vt'));
}
