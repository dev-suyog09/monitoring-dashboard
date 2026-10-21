import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;
type Loader<T extends AnyComponent> = () => Promise<{ default: T }>;
const loaders: Array<() => Promise<unknown>> = [];

/**
 * React.lazy plus a registry: the chunk is split out of the first download, and `preloadLazyChunks()` fetches all of them
 * in the browser's idle time after the page is up, so the first click on a tab or panel is instant instead of waiting.
 */
export function lazyPreload<T extends AnyComponent>(load: Loader<T>): LazyExoticComponent<T> {
  let promise: Promise<{ default: T }> | null = null;
  const once = () => (promise ??= load());
  loaders.push(once);
  return lazy(once);
}

export function preloadLazyChunks(): void {
  for (const l of loaders) void l().catch(() => undefined);
}

/** Runs `fn` when the browser is idle (or soon, where that API does not exist). */
export function whenIdle(fn: () => void, timeout = 2500): () => void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(t);
}
