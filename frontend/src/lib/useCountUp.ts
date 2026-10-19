import { useEffect, useRef, useState } from 'react';

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Animates a number from its previous value to `target` (ease-out). Starts from 0 on first render, so
 * cards, the gauge and chart totals count up when the page opens and glide when a filter changes them.
 */
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (reducedMotion()) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = a + (target - a) * eased;
      from.current = cur;
      setValue(cur);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);

  return value;
}
