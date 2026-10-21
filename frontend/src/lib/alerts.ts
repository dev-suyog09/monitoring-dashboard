import type { InfraCloudService, InfraInstance } from '../types';
/** Every state other than Started is worth a notification (red: Stopped / Unresponsive, yellow: the rest). */
const isAlertState = (status: string): boolean => status.trim().toLowerCase() !== 'started';

/** One entry in the notification bell. */
export interface AlertItem {
  id: string;
  /** down = an instance left the Started state (any other state); recovered = it is Started again. */
  kind: 'down' | 'recovered';
  at: string;
  status: string;
  instance: string;
  cloudService: string;
  subscription: string;
  read: boolean;
}

interface Stored {
  /** False on the very first visit (nothing saved yet): the first state seen is then a silent baseline. */
  stored?: boolean;
  items: AlertItem[];
  /** Instances currently known to be red (key -> status), so a reload or re-check doesn't re-alert them. */
  red: Record<string, string>;
}

const STORE_KEY = 'sam.alerts';
const DESKTOP_KEY = 'sam.alerts.desktop';
const SOUND_KEY = 'sam.alerts.sound';
const MAX_ITEMS = 60;

export const instKey = (i: { subscriptionId: string; cloudService: string; instance: string }) =>
  `${i.subscriptionId}|${i.cloudService}|${i.instance}`.toLowerCase();

export function loadAlerts(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { stored: false, items: [], red: {} };
    const p = JSON.parse(raw) as Partial<Stored>;
    return { stored: true, items: Array.isArray(p.items) ? p.items.slice(0, MAX_ITEMS) : [], red: p.red && typeof p.red === 'object' ? p.red : {} };
  } catch {
    return { stored: false, items: [], red: {} };
  }
}

export function saveAlerts(s: Stored): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ items: s.items.slice(0, MAX_ITEMS), red: s.red }));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export const loadDesktopPref = (): boolean => {
  try {
    return localStorage.getItem(DESKTOP_KEY) === '1';
  } catch {
    return false;
  }
};
export const saveDesktopPref = (on: boolean): void => {
  try {
    localStorage.setItem(DESKTOP_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
};

export const loadSoundPref = (): boolean => {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0'; // on unless switched off
  } catch {
    return true;
  }
};
export const saveSoundPref = (on: boolean): void => {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
};

/**
 * Pure: compare what was red before with the latest check.
 *  - an instance that is in a non-Started state now and wasn't before, or whose state changed -> an alert
 *  - one that was not Started, is present and is Started again       -> a "recovered" note
 *  - one that was red but whose cloud service wasn't re-checked       -> stays red (state unknown, no alert)
 *  - one that vanished from a re-checked service (scaled in)          -> dropped silently
 */
export function diffAlerts(
  prevRed: Record<string, string>,
  instances: InfraInstance[],
  services: InfraCloudService[],
  nowIso: string,
): { red: Record<string, string>; created: AlertItem[] } {
  const checked = new Set(services.filter((s) => s.checkedAt).map((s) => `${s.subscriptionId}|${s.name}`.toLowerCase()));
  const byKey = new Map(instances.map((i) => [instKey(i), i]));
  const red: Record<string, string> = {};
  const created: AlertItem[] = [];

  const item = (kind: AlertItem['kind'], i: InfraInstance): AlertItem => ({
    id: `${nowIso}|${kind}|${instKey(i)}`,
    kind,
    at: nowIso,
    status: i.status,
    instance: i.instance,
    cloudService: i.cloudService,
    subscription: i.subscription,
    read: false,
  });

  for (const i of instances) {
    if (!isAlertState(i.status)) continue;
    const k = instKey(i);
    red[k] = i.status;
    if (prevRed[k] !== i.status) created.push(item('down', i)); // newly out of Started, or moved to another state
  }
  for (const [k, status] of Object.entries(prevRed)) {
    if (k in red) continue;
    const now = byKey.get(k);
    if (now) created.push(item('recovered', now));
    else if (!checked.has(k.split('|').slice(0, 2).join('|'))) red[k] = status; // not re-checked: keep as red
  }
  return { red, created };
}
