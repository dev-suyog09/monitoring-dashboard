import { useCallback, useEffect, useState } from 'react';

/** True when the page is fullscreen: via the button (Fullscreen API) or via the browser's own F11 / kiosk mode. */
function detectFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.fullscreenElement) return true;
  if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  // F11 doesn't use the Fullscreen API: the whole window then covers the screen, which a normal or maximised window
  // (it leaves the taskbar) never does. Outer sizes are used because, unlike inner sizes, browser zoom doesn't change them.
  return window.outerWidth >= screen.width && window.outerHeight >= screen.height;
}

/**
 * Fullscreen for the whole page. While active, `<html data-fullscreen="true">` is set so the stylesheet can switch to the
 * full-width layout; the normal view is untouched. `blocked` flashes true when a request was made but the browser
 * did not go fullscreen.
 */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [active, setActive] = useState(detectFullscreen);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const update = () => setActive(detectFullscreen());
    document.addEventListener('fullscreenchange', update);
    window.addEventListener('resize', update);
    const mq = window.matchMedia?.('(display-mode: fullscreen)');
    mq?.addEventListener?.('change', update);
    update();
    return () => {
      document.removeEventListener('fullscreenchange', update);
      window.removeEventListener('resize', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.fullscreen = active ? 'true' : 'false';
  }, [active]);

  const toggle = useCallback(async () => {
    const viaApi = !!document.fullscreenElement;
    try {
      if (viaApi) await document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      /* refused — handled below */
    }
    if (!viaApi) {
      // some browsers / embedded views silently ignore the request: say so instead of doing nothing
      setTimeout(() => {
        if (!detectFullscreen()) {
          setBlocked(true);
          setTimeout(() => setBlocked(false), 5000);
        }
      }, 800);
    }
  }, []);

  return { supported, active, blocked, toggle };
}
