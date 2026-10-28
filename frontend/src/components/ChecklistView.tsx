import '../checklist.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, everyHours, REPEAT_CHOICES, useChecklist, type ChecklistData, type Notice } from '../lib/checklist';
import type { WatchGroup } from '../lib/watchlist';

/** Email reminders are built but hidden for now; flip this to show the email address, test button and mail-server notice again. */
const SHOW_EMAIL = false;
const EMAIL_RE = /^[^\s@<>",;()[\]\\]+@[^\s@<>",;()[\]\\]+\.[^\s@<>",;()[\]\\]+$/;
/** One colour per list, in order, like the coloured squares of a task app. */
const COLORS = ['#ff6b6b', '#5ab0ff', '#ffd24a', '#34d399', '#a78bfa', '#fb923c', '#2dd4bf', '#f472b6'];

function nextLabel(d: ChecklistData): string {
  if (!d.enabled) return 'Reminders are off';
  if (!d.teams.configured && !d.email) return 'Connect Teams to get reminders';
  if (!d.nextReminder) return 'No reminder times set';
  const n = new Date(d.nextReminder);
  const sameDay = n.toDateString() === new Date().toDateString();
  return `Next reminder ${sameDay ? 'today' : 'tomorrow'} at ${n.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

interface Item {
  list: string;
  name: string;
  done: boolean;
  color: string;
}

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICONS = {
  today: 'M9 6h11M9 12h11M9 18h11M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17',
  pending: 'M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  done: 'M20 6 9 17l-5-5',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  chevron: 'M9 6l6 6-6 6',
  users: 'M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20M11 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
};

/**
 * Daily health-check checklist, laid out like a task app: menu and lists on the left, the things to check in the middle,
 * details of the selected customer (or the reminder settings) on the right. Unticked customers are sent to Teams at the
 * reminder times.
 */
export default function ChecklistView({
  groups,
  defaultEmail,
  onOpenCustomers,
  onOpenCustomer,
}: {
  groups: WatchGroup[];
  defaultEmail?: string | null;
  onOpenCustomers: () => void;
  /** Show this customer on the Customers tab. */
  onOpenCustomer?: (term: string) => void;
}) {
  const { data, error, toggle, saveSettings, testMail, testTeams } = useChecklist(groups);
  const [view, setView] = useState('today');
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<{ list: string; name: string } | null>(null);
  const [email, setEmail] = useState('');
  const [time, setTime] = useState('09:00');
  const [teamsUrl, setTeamsUrl] = useState('');
  const [every, setEvery] = useState(3);
  const [from, setFrom] = useState('00:00');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const side = useRef<HTMLElement>(null);

  useEffect(() => {
    if (data) setEmail((cur) => cur || data.email || '');
  }, [data]);

  const lists = data?.lists ?? [];
  const tracked = (name: string) => !data || data.tracked === null || data.tracked.includes(name);
  const items: Item[] = useMemo(
    () => lists.flatMap((l, i) => l.members.map((m) => ({ list: l.name, name: m, done: l.done.includes(m), color: COLORS[i % COLORS.length]! }))),
    [lists],
  );

  if (!data) return <div className="skeleton" style={{ height: 320 }} aria-busy>{error && <p className="panel-empty">{error}</p>}</div>;

  const listColor = (name: string) => COLORS[Math.max(0, lists.findIndex((l) => l.name === name)) % COLORS.length]!;
  const inView = (it: Item) => (view.startsWith('l:') ? it.list === view.slice(2) : view === 'pending' ? !it.done : view === 'done' ? it.done : true);
  const shown = items.filter((it) => inView(it) && (!query.trim() || `${it.name} ${it.list}`.toLowerCase().includes(query.trim().toLowerCase())));
  const pendingCount = (f: (it: Item) => boolean = () => true) => items.filter((it) => !it.done && f(it)).length;
  const trackedItems = items.filter((it) => tracked(it.list));
  const total = trackedItems.length;
  const done = trackedItems.filter((it) => it.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const emailOk = EMAIL_RE.test(email.trim());
  const selList = view.startsWith('l:') ? lists.find((l) => l.name === view.slice(2)) : undefined;
  const title = selList ? selList.name : { today: 'Today', pending: 'Pending', done: 'Done' }[view] ?? 'Today';
  const pickItem = pick ? items.find((it) => it.list === pick.list && it.name === pick.name) : undefined;
  // "Mark all done" acts on what is shown: one list, or every list on the Today / Pending views
  const scope = selList ? [selList.name] : lists.map((l) => l.name);

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: okText });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };
  const setTracked = (name: string, on: boolean) => {
    const all = lists.map((l) => l.name);
    const cur = data.tracked ?? all;
    void saveSettings({ tracked: on ? [...new Set([...cur, name])] : cur.filter((n) => n !== name) });
  };
  const showReminders = () => {
    setPick(null);
    side.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (lists.length === 0)
    return (
      <div className="cx-empty">
        <h3>No lists to check yet</h3>
        <p>
          A list is a saved group from the Customers tab, for example <b>Daily HC</b>. Search for the customers you check every day, choose <b>Groups → Save as group</b>, and they appear here as a checklist.
        </p>
        <button className="btn-accent" onClick={onOpenCustomers}>
          Go to Customers
        </button>
      </div>
    );

  const menuItem = (key: string, label: string, icon: string, count: number, dot?: string) => (
    <button key={key} className={`cx-nav${view === key ? ' on' : ''}`} onClick={() => { setView(key); setPick(null); }} aria-current={view === key ? 'page' : undefined}>
      {dot ? <i className="cx-dot" style={{ background: dot }} aria-hidden /> : <Icon d={icon} />}
      <span className="cx-nav-name">{label}</span>
      <span className="cx-count mono">{count}</span>
    </button>
  );

  return (
    <div className="cx">
      {/* ── left: menu and lists ── */}
      <nav className="cx-menu" aria-label="Checklist menu">
        <h2>Checklist</h2>
        <label className="cx-search">
          <Icon d={ICONS.search} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search the checklist" />
        </label>
        <div className="cx-label">Today</div>
        {menuItem('today', 'All checks', ICONS.today, items.length)}
        {menuItem('pending', 'Still to check', ICONS.pending, pendingCount())}
        {menuItem('done', 'Checked', ICONS.done, items.length - pendingCount())}
        <div className="cx-label">Lists</div>
        {lists.map((l) => menuItem(`l:${l.name}`, l.name, '', pendingCount((it) => it.list === l.name), listColor(l.name)))}
        <div className="cx-spacer" />
        <button className="cx-nav cx-bell" onClick={showReminders}>
          <Icon d={ICONS.bell} />
          <span className="cx-nav-name">Reminders</span>
          <span className={`cx-state${data.enabled && data.teams.configured ? ' ok' : ''}`}>{data.enabled && data.teams.configured ? 'On' : 'Off'}</span>
        </button>
      </nav>

      {/* ── middle: what to check ── */}
      <section className="cx-main" aria-label={title}>
        <header className="cx-head">
          <h1>{title}</h1>
          <span className="cx-badge mono" title="Still to check">{view === 'done' ? shown.length : shown.filter((i) => !i.done).length}</span>
          <div className="cx-head-actions">
            <button className="pill" disabled={shown.every((i) => i.done)} onClick={() => scope.forEach((l) => void toggle(l, null, true))}>
              ✓ Mark all done
            </button>
            <button className="pill" disabled={!shown.some((i) => i.done)} onClick={() => scope.forEach((l) => void toggle(l, null, false))}>
              Clear
            </button>
          </div>
        </header>

        <div className="cx-progress">
          <div className="cx-ring" style={{ ['--p' as string]: `${pct}%` }} aria-hidden>
            <b className="mono">{pct}%</b>
          </div>
          <div>
            <b className="mono">{total === 0 ? 'No lists tracked' : `${done} of ${total} checked${done === total ? ' · all done' : ''}`}</b>
            <span className="cx-next">{nextLabel(data)}</span>
          </div>
        </div>

        {error && <div className="banner banner-err">{error}</div>}

        {shown.length === 0 ? (
          <p className="cx-none">{query ? 'Nothing matches your search.' : view === 'done' ? 'Nothing is ticked yet today.' : view === 'pending' ? 'Everything is checked. 🎉' : 'This list has no customers.'}</p>
        ) : (
          <ul className="cx-rows">
            {shown.map((it) => (
              <li key={`${it.list}\u0000${it.name}`} className={`cx-row${it.done ? ' on' : ''}${pick?.list === it.list && pick.name === it.name ? ' sel' : ''}`}>
                <label className="cx-check" title={it.done ? 'Checked: click to undo' : 'Mark as checked'}>
                  <input type="checkbox" checked={it.done} onChange={(e) => void toggle(it.list, it.name, e.target.checked)} aria-label={`${it.list}: ${it.name}`} />
                  <span className="cx-box" aria-hidden />
                </label>
                <button className="cx-row-main" onClick={() => setPick({ list: it.list, name: it.name })} aria-label={`Details of ${it.name}`}>
                  <span className="cx-name">{it.name}</span>
                  <span className="cx-meta">
                    <i className="cx-dot sq" style={{ background: it.color }} aria-hidden />
                    {it.list}
                    <span className={`cx-chip${it.done ? ' ok' : ''}`}>{it.done ? 'Checked' : 'To check'}</span>
                  </span>
                </button>
                <span className="cx-go" aria-hidden>
                  <Icon d={ICONS.chevron} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── right: details of the selected customer, or the reminder settings ── */}
      <aside className="cx-side" ref={side} aria-label={pickItem ? 'Customer details' : 'Reminders'}>
        {pickItem ? (
          <>
            <div className="cx-side-hd">
              <button className="cx-back" onClick={() => setPick(null)} aria-label="Back to reminders">
                ← Reminders
              </button>
              <h2>Customer</h2>
            </div>
            <div className="cx-big">{pickItem.name}</div>
            <dl className="cx-facts">
              <dt>List</dt>
              <dd>
                <i className="cx-dot sq" style={{ background: pickItem.color }} aria-hidden /> {pickItem.list}
              </dd>
              <dt>Today</dt>
              <dd>
                <span className={`cx-chip${pickItem.done ? ' ok' : ''}`}>{pickItem.done ? 'Checked' : 'Still to check'}</span>
              </dd>
              <dt>Reminders</dt>
              <dd>
                <label className="cl-inline">
                  <input type="checkbox" checked={tracked(pickItem.list)} onChange={(e) => setTracked(pickItem.list, e.target.checked)} aria-label={`Remind me about ${pickItem.list}`} />
                  Remind me about this list
                </label>
              </dd>
            </dl>
            <div className="cx-side-foot">
              {onOpenCustomer && (
                <button className="pill" onClick={() => onOpenCustomer(pickItem.name)}>
                  <Icon d={ICONS.users} /> Open in Customers
                </button>
              )}
              <button className="btn-accent" onClick={() => void toggle(pickItem.list, pickItem.name, !pickItem.done)}>
                {pickItem.done ? 'Mark as not checked' : '✓ Mark as checked'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="cx-side-hd">
              <h2>Reminders</h2>
              <label className="cl-remind" title="Turn all reminders on or off">
                <input type="checkbox" checked={data.enabled} onChange={(e) => void saveSettings({ enabled: e.target.checked })} aria-label="Send reminders" />
                <span>{data.enabled ? 'On' : 'Off'}</span>
              </label>
            </div>
            <div className="cl-form">
              <TeamsBox
                configured={data.teams.configured}
                value={teamsUrl}
                setValue={setTeamsUrl}
                busy={busy}
                last={data.lastTeams}
                onSave={() => void run(async () => { await saveSettings({ teamsUrl: teamsUrl.trim() }); setTeamsUrl(''); }, 'Teams connected.')}
                onRemove={() => void run(() => saveSettings({ teamsUrl: '' }), 'Teams removed.')}
                onTest={() => void run(testTeams, 'Test message sent to Teams.')}
              />
              {note && (
                <p className={note.ok ? 'cl-ok' : 'cl-bad'} role="status">
                  {note.text}
                </p>
              )}

              <div className="cl-field">
                <span>Remind me at</span>
                <div className="cl-row cl-times">
                  {data.times.map((t) => (
                    <span key={t} className="cl-time">
                      {clock(t)}
                      <button aria-label={`Remove ${clock(t)}`} onClick={() => void saveSettings({ times: data.times.filter((x) => x !== t) })}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div className="cl-row">
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="New reminder time" />
                  <button className="pill" disabled={!time || data.times.includes(time) || data.times.length >= 24} onClick={() => void saveSettings({ times: [...data.times, time] })}>
                    + Add time
                  </button>
                </div>
                <small>If anything on a tracked list is still unticked at these times (your computer's local time), you get one Teams message listing what is missing. Nothing is sent once everything is ticked.</small>
              </div>

              <div className="cl-field">
                <span>Quick schedule</span>
                <div className="cl-row">
                  <label className="cl-inline">
                    Every
                    <select value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label="Hours between reminders">
                      {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? 'hour' : 'hours'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cl-inline">
                    from
                    <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="First reminder time" />
                  </label>
                  <button className="pill" disabled={busy || !from} onClick={() => void run(() => saveSettings({ times: everyHours(every, from) }), `Reminders set every ${every} ${every === 1 ? 'hour' : 'hours'} from ${clock(from)}.`)}>
                    Fill in the times
                  </button>
                </div>
                <label className="cl-inline cl-repeat">
                  <input type="checkbox" checked={data.repeat} onChange={(e) => void saveSettings({ repeat: e.target.checked })} aria-label="Keep reminding until everything is ticked" />
                  Keep reminding until everything is ticked, every
                  <select value={data.repeatMinutes} disabled={!data.repeat} onChange={(e) => void saveSettings({ repeatMinutes: Number(e.target.value) })} aria-label="Repeat interval">
                    {REPEAT_CHOICES.map((c) => (
                      <option key={c.minutes} value={c.minutes}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <small>Repeating starts at your first reminder time each day and stops as soon as everything is ticked (or at midnight).</small>
              </div>

              <div className="cl-field">
                <span>Lists in the reminders</span>
                <div className="cx-tracks">
                  {lists.map((l) => (
                    <label key={l.name} className="cl-inline">
                      <input type="checkbox" checked={tracked(l.name)} onChange={(e) => setTracked(l.name, e.target.checked)} aria-label={`Remind me about ${l.name}`} />
                      <i className="cx-dot sq" style={{ background: listColor(l.name) }} aria-hidden />
                      {l.name}
                    </label>
                  ))}
                </div>
              </div>

              {/* Email reminders are built (backend + this form) but switched off for now: set SHOW_EMAIL to bring them back. */}
              {SHOW_EMAIL && (
                <>
                  <label className="cl-field">
                    <span>Your email</span>
                    <div className="cl-row">
                      <input type="email" value={email} placeholder={defaultEmail ?? 'name@company.com'} onChange={(e) => setEmail(e.target.value)} aria-label="Your email address" autoComplete="email" />
                      <button className="btn-accent" disabled={busy || !emailOk || email.trim() === data.email} onClick={() => void run(() => saveSettings({ email: email.trim() }), 'Email saved.')}>
                        Save
                      </button>
                    </div>
                    {email && !emailOk && <small className="cl-bad">That does not look like an email address.</small>}
                  </label>
                  <div className="cl-row">
                    <button className="pill" disabled={busy || !data.email || !data.smtp.configured} onClick={() => void run(testMail, `Test email sent to ${data.email}.`)}>
                      ✉ Send a test email
                    </button>
                  </div>
                  {!data.smtp.configured && (
                    <div className="banner banner-warm cl-smtp">
                      Email is not set up on this server yet. Add <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>MAIL_FROM</code> to <code>backend/.env</code> and restart the backend.
                    </div>
                  )}
                  {data.lastMail && (
                    <p className={data.lastMail.ok ? 'cl-ok' : 'cl-bad'}>
                      Last reminder ({clock(data.lastMail.slot)}): {data.lastMail.ok ? 'sent' : `failed${data.lastMail.error ? ` · ${data.lastMail.error}` : ''}`} · {new Date(data.lastMail.at).toLocaleString()}
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function TeamsBox({
  configured,
  value,
  setValue,
  busy,
  last,
  onSave,
  onRemove,
  onTest,
}: {
  configured: boolean;
  value: string;
  setValue: (v: string) => void;
  busy: boolean;
  last: Notice | null;
  onSave: () => void;
  onRemove: () => void;
  onTest: () => void;
}) {
  const ok = /^https:\/\/\S+$/.test(value.trim());
  return (
    <div className="cl-field cl-teams">
      <span>Teams message {configured && <b className="cl-ok">· connected</b>}</span>
      {configured ? (
        <div className="cl-row">
          <button className="pill" disabled={busy} onClick={onTest}>
            💬 Send a test message
          </button>
          <button className="pill" disabled={busy} onClick={onRemove}>
            Disconnect Teams
          </button>
        </div>
      ) : (
        <>
          <ol className="cl-steps">
            <li>In Teams, open the chat you want the reminders in (a chat with just yourself works well).</li>
            <li>
              Open <b>Workflows</b> and pick <b>“Post to a chat when a webhook request is received”</b>, choose that chat, and copy the address it gives you.
            </li>
            <li>Paste it below and save. The address is a secret: it is kept on the server only and never shown again.</li>
          </ol>
          <div className="cl-row">
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://…logic.azure.com/… or …powerplatform.com/…"
              aria-label="Teams workflow address"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn-accent" disabled={busy || !ok} onClick={onSave}>
              Connect
            </button>
          </div>
        </>
      )}
      {last && (
        <p className={last.ok ? 'cl-ok' : 'cl-bad'}>
          Last Teams reminder ({clock(last.slot)}): {last.ok ? 'sent' : `failed${last.error ? ` · ${last.error}` : ''}`} · {new Date(last.at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
