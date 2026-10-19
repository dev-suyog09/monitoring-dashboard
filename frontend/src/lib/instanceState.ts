/**
 * How a cloud service role-instance state is shown:
 *   Started                          -> green
 *   Stopped, Unresponsive            -> red    (the only ones counted on the tab badge)
 *   Starting and any other state     -> yellow (Aborted, Unknown, Busy, Stopping ...)
 */
export type InstanceLevel = 'ok' | 'bad' | 'warn';

/** Red states. */
export const isDownState = (status: string): boolean => /^(stopped|unresponsive)/i.test(status.trim());

export function instanceLevel(status: string): InstanceLevel {
  if (status === 'Started') return 'ok';
  return isDownState(status) ? 'bad' : 'warn';
}

/** CSS scope class that colours a chip / row. */
export const LEVEL_SCOPE: Record<InstanceLevel, string> = { ok: 'st-ok', bad: 'st-err', warn: 'st-warn' };
