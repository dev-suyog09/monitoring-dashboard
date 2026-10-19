/** A saved set of search terms the user watches together. */
export interface WatchGroup {
  name: string;
  terms: string[];
}

const KEY = 'sam.watchgroups';

export function loadGroups(): WatchGroup[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is WatchGroup =>
        !!g && typeof (g as WatchGroup).name === 'string' && Array.isArray((g as WatchGroup).terms),
    );
  } catch {
    return [];
  }
}

export function saveGroups(groups: WatchGroup[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(groups));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}
