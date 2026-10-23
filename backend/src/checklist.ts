import { todayStr } from './checker.js';

/**
 * The daily health-check checklist: for every saved list (a "group" on the Customers tab, e.g. "Daily HC") the dashboard
 * ticks off each member once it has been checked today. If members are still unticked at a reminder time (default 12 AM,
 * 3 AM and 6 AM) an email goes to the address the user entered once. Everything here is pure (no clock, no network) so it
 * can be unit tested; server.ts owns the timer and the mailer.
 */

export interface ChecklistList {
  name: string;
  members: string[];
}

export interface DoneEntry {
  date: string;
  list: string;
  members: string[];
}

export interface SentEntry {
  date: string;
  slots: string[];
}

export interface ChecklistState {
  email: string;
  /** Teams "workflow" webhook URL: a secret, kept on the server only. Empty = no Teams messages. */
  teamsUrl: string;
  enabled: boolean;
  /** Reminder times, "HH:MM" 24 h, local time. */
  times: string[];
  /** After the first reminder time each day, keep reminding every `repeatMinutes` until everything is ticked (or the day ends). */
  repeat: boolean;
  repeatMinutes: number;
  /** Lists that are reminded about; null = every list. */
  tracked: string[] | null;
  lists: ChecklistList[];
  done: DoneEntry[];
  /** Reminder slots already handled today, so a restart never sends the same reminder twice. */
  sent: SentEntry[];
  lastMail: Notice | null;
  lastTeams: Notice | null;
}

export interface Notice {
  at: string;
  ok: boolean;
  slot: string;
  error?: string;
}

export type Channel = 'email' | 'teams';

export const DEFAULT_TIMES = ['00:00', '03:00', '06:00'];
/** A reminder missed because the backend was down is still sent if it is at most this late. */
export const GRACE_MS = 60 * 60_000;
const KEEP_DAYS = 14;

export const emptyState = (): ChecklistState => ({ email: '', teamsUrl: '', enabled: true, times: [...DEFAULT_TIMES], repeat: false, repeatMinutes: 60, tracked: null, lists: [], done: [], sent: [], lastMail: null, lastTeams: null });

const EMAIL_RE = /^[^\s@<>",;()[\]\\]+@[^\s@<>",;()[\]\\]+\.[^\s@<>",;()[\]\\]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null);

export const isEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);

/**
 * Only Microsoft's own webhook hosts are accepted (Teams "Workflows" run on Power Automate), so the server can never be
 * pointed at an arbitrary address (SSRF) and the secret URL is only ever sent to Microsoft over https.
 */
const TEAMS_HOSTS = [/^([a-z0-9-]+\.)*webhook\.office\.com$/, /^outlook\.office\.com$/, /^([a-z0-9-]+\.)*logic\.azure\.com$/, /^([a-z0-9-]+\.)*powerplatform\.com$/];
export function isTeamsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && TEAMS_HOSTS.some((r) => r.test(u.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

export class BadInput extends Error {}

/** Lists coming from the browser: bounded sizes, de-duplicated, only plain strings. */
export function cleanLists(input: unknown): ChecklistList[] {
  if (!Array.isArray(input) || input.length > 100) throw new BadInput('Invalid lists.');
  const seen = new Set<string>();
  const out: ChecklistList[] = [];
  for (const raw of input) {
    const name = str((raw as ChecklistList | null)?.name, 80);
    const members = (raw as ChecklistList | null)?.members;
    if (!name || !Array.isArray(members) || members.length > 300) throw new BadInput('Invalid lists.');
    if (seen.has(name)) continue;
    seen.add(name);
    const m = [...new Set(members.map((x) => str(x, 80)).filter((x): x is string => !!x))];
    out.push({ name, members: m });
  }
  return out;
}

export const MAX_TIMES = 24;
export const REPEAT_CHOICES = [15, 30, 60, 90, 120, 180, 240];

export function cleanTimes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAX_TIMES || input.some((t) => typeof t !== 'string' || !TIME_RE.test(t))) throw new BadInput('Reminder times must look like 03:00.');
  return [...new Set(input as string[])].sort();
}

const trimOld = <T extends { date: string }>(rows: T[], today: string): T[] => {
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const c = todayStr(cutoff);
  return rows.filter((r) => r.date >= c);
};

export function setProfile(s: ChecklistState, body: { email?: unknown; teamsUrl?: unknown; enabled?: unknown; times?: unknown; repeat?: unknown; repeatMinutes?: unknown; tracked?: unknown }, today = todayStr()): ChecklistState {
  const next = { ...s };
  if (body.teamsUrl !== undefined) {
    if (body.teamsUrl === '') next.teamsUrl = '';
    else if (isTeamsUrl(body.teamsUrl)) next.teamsUrl = body.teamsUrl;
    else throw new BadInput('That is not a Teams workflow address. It should start with https:// and come from Microsoft (webhook.office.com, logic.azure.com or powerplatform.com).');
  }
  if (body.email !== undefined) {
    if (body.email === '') next.email = '';
    else if (isEmail(body.email)) next.email = body.email;
    else throw new BadInput('That does not look like an email address.');
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new BadInput('Invalid value.');
    next.enabled = body.enabled;
  }
  if (body.times !== undefined) next.times = cleanTimes(body.times);
  if (body.repeat !== undefined) {
    if (typeof body.repeat !== 'boolean') throw new BadInput('Invalid value.');
    next.repeat = body.repeat;
  }
  if (body.repeatMinutes !== undefined) {
    if (typeof body.repeatMinutes !== 'number' || !REPEAT_CHOICES.includes(body.repeatMinutes)) throw new BadInput('Pick one of the offered repeat intervals.');
    next.repeatMinutes = body.repeatMinutes;
  }
  if (body.tracked !== undefined) {
    if (body.tracked === null) next.tracked = null;
    else if (Array.isArray(body.tracked) && body.tracked.length <= 100 && body.tracked.every((n) => typeof n === 'string' && n.length <= 80)) next.tracked = body.tracked as string[];
    else throw new BadInput('Invalid tracked lists.');
  }
  next.done = trimOld(next.done, today);
  next.sent = trimOld(next.sent, today);
  return next;
}

export function setLists(s: ChecklistState, lists: ChecklistList[]): ChecklistState {
  return { ...s, lists };
}

/** Tick (or untick) one member, or the whole list, for `date`. */
export function mark(s: ChecklistState, date: string, list: string, member: string | null, done: boolean): ChecklistState {
  const l = s.lists.find((x) => x.name === list);
  if (!l) throw new BadInput('Unknown list.');
  if (member !== null && !l.members.includes(member)) throw new BadInput('That member is not in the list.');
  const current = new Set(s.done.find((d) => d.date === date && d.list === list)?.members ?? []);
  for (const m of member === null ? l.members : [member]) (done ? current.add(m) : current.delete(m));
  const rest = s.done.filter((d) => !(d.date === date && d.list === list));
  return { ...s, done: [...rest, { date, list, members: [...current] }] };
}

export const doneFor = (s: ChecklistState, date: string, list: string): string[] => s.done.find((d) => d.date === date && d.list === list)?.members ?? [];

export const trackedLists = (s: ChecklistState): ChecklistList[] => s.lists.filter((l) => l.members.length > 0 && (s.tracked === null || s.tracked.includes(l.name)));

/** What is still unticked on `date`, per tracked list. Lists that are complete are left out. */
export function pending(s: ChecklistState, date: string): { name: string; missing: string[]; total: number }[] {
  return trackedLists(s)
    .map((l) => {
      const d = new Set(doneFor(s, date, l.name));
      return { name: l.name, missing: l.members.filter((m) => !d.has(m)), total: l.members.length };
    })
    .filter((p) => p.missing.length > 0);
}

const slotDate = (now: Date, t: string): Date => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
};

/** Reminder slots that have come due today and were not handled yet (and are not older than the grace period). */
const sentKey = (slot: string, channel: Channel) => (channel === 'email' ? slot : `${slot}@teams`);

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** The reminder times of a day: the chosen ones, plus (with "repeat") every N minutes from the first one until midnight. */
export function effectiveTimes(s: ChecklistState): string[] {
  if (!s.repeat || s.times.length === 0) return s.times;
  const [h, m] = s.times[0]!.split(':').map(Number) as [number, number];
  const all = new Set(s.times);
  for (let t = h * 60 + m; t < 24 * 60; t += s.repeatMinutes) all.add(hhmm(t));
  return [...all].sort();
}

export function dueSlots(s: ChecklistState, now: Date, channel: Channel = 'email'): string[] {
  const date = todayStr(now);
  const handled = new Set(s.sent.find((x) => x.date === date)?.slots ?? []);
  return effectiveTimes(s).filter((t) => {
    const age = now.getTime() - slotDate(now, t).getTime();
    return age >= 0 && age <= GRACE_MS && !handled.has(sentKey(t, channel));
  });
}

export function markSent(s: ChecklistState, date: string, slot: string, channel: Channel = 'email'): ChecklistState {
  const cur = s.sent.find((x) => x.date === date);
  const rest = s.sent.filter((x) => x.date !== date);
  return { ...s, sent: [...rest, { date, slots: [...new Set([...(cur?.slots ?? []), sentKey(slot, channel)])] }] };
}

/**
 * The reminder to send now for a channel: only the newest due slot (if the backend was down for a while, several can be due at
 * once, and one message is enough); the older ones are marked as handled.
 */
export function takeDue(s: ChecklistState, date: string, now: Date, channel: Channel): { state: ChecklistState; slot: string | null } {
  const due = dueSlots(s, now, channel);
  let state = s;
  for (const old of due.slice(0, -1)) state = markSent(state, date, old, channel);
  return { state, slot: due[due.length - 1] ?? null };
}

/** Is there anywhere to send reminders to? */
export const hasChannel = (s: ChecklistState): boolean => isEmail(s.email) || isTeamsUrl(s.teamsUrl);

/** The next reminder time from `now` (today's later slots, else the first one tomorrow), or null if reminders are off. */
export function nextReminder(s: ChecklistState, now: Date): Date | null {
  if (!s.enabled || !hasChannel(s) || s.times.length === 0) return null;
  const later = effectiveTimes(s).map((t) => slotDate(now, t)).filter((d) => d.getTime() > now.getTime()).sort((a, b) => a.getTime() - b.getTime())[0];
  if (later) return later;
  const first = slotDate(now, s.times[0]!);
  first.setDate(first.getDate() + 1);
  return first;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clock = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
export const slotLabel = clock;

export function buildMail(p: { name: string; missing: string[]; total: number }[], slot: string, date: string, url: string): { subject: string; text: string; html: string } {
  const missing = p.reduce((n, x) => n + x.missing.length, 0);
  const total = p.reduce((n, x) => n + x.total, 0);
  const subject = `Health check reminder: ${missing} of ${total} not checked yet (${clock(slot)})`;
  const text =
    `Reminder for ${date}, ${clock(slot)}\n\n` +
    p.map((x) => `${x.name}: ${x.total - x.missing.length}/${x.total} checked\n  still to check: ${x.missing.join(', ')}`).join('\n\n') +
    `\n\nOpen the dashboard and tick them off: ${url}\n`;
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1f">` +
    `<h2 style="margin:0 0 4px">Health check reminder</h2><p style="margin:0 0 14px;color:#6e6e73">${esc(date)} · ${esc(clock(slot))}</p>` +
    p
      .map(
        (x) =>
          `<p style="margin:0 0 4px"><b>${esc(x.name)}</b> &mdash; ${x.total - x.missing.length}/${x.total} checked</p>` +
          `<ul style="margin:0 0 14px">${x.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`,
      )
      .join('') +
    `<p><a href="${esc(url)}">Open the dashboard</a> and tick them off once checked.</p></div>`;
  return { subject, text, html };
}

/** The Teams message: an Adaptive Card, which both Teams "Workflows" webhooks and the older connectors accept. */
export function buildTeams(p: { name: string; missing: string[]; total: number }[], slot: string, date: string, url: string): object {
  const missing = p.reduce((n, x) => n + x.missing.length, 0);
  const total = p.reduce((n, x) => n + x.total, 0);
  const body: object[] = [
    { type: 'TextBlock', text: `Health check reminder · ${missing} of ${total} not checked yet`, weight: 'Bolder', size: 'Medium', wrap: true },
    { type: 'TextBlock', text: `${date} · ${clock(slot)}`, isSubtle: true, spacing: 'None', wrap: true },
    ...p.flatMap((x) => [
      { type: 'TextBlock', text: `${x.name}: ${x.total - x.missing.length}/${x.total} checked`, weight: 'Bolder', spacing: 'Medium', wrap: true },
      { type: 'TextBlock', text: `Still to check: ${x.missing.join(', ')}`, wrap: true, spacing: 'Small' },
    ]),
  ];
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          actions: [{ type: 'Action.OpenUrl', title: 'Open the dashboard', url }],
        },
      },
    ],
  };
}

/** A short plain test card. */
export const teamsTestCard = (times: string[]): object => ({
  type: 'message',
  attachments: [
    {
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: 'Health check reminders are working', weight: 'Bolder', size: 'Medium', wrap: true },
          { type: 'TextBlock', text: `You will get a message here at ${times.map(clock).join(', ')} while health checks are not ticked off.`, wrap: true },
        ],
      },
    },
  ],
});
