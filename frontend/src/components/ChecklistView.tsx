import '../checklist.css';
import { useEffect, useState } from 'react';
import { clock, everyHours, REPEAT_CHOICES, useChecklist, type ChecklistData, type Notice } from '../lib/checklist';
import type { WatchGroup } from '../lib/watchlist';

/** Email reminders are built but hidden for now; flip this to show the email address, test button and mail-server notice again. */
const SHOW_EMAIL = false;
const EMAIL_RE = /^[^\s@<>",;()[\]\\]+@[^\s@<>",;()[\]\\]+\.[^\s@<>",;()[\]\\]+$/;

function nextLabel(d: ChecklistData): string {
  if (!d.enabled) return 'Reminders are off';
  if (!d.teams.configured && !d.email) return 'Connect Teams to get reminders';
  if (!d.nextReminder) return 'No reminder times set';
  const n = new Date(d.nextReminder);
  const sameDay = n.toDateString() === new Date().toDateString();
  return `Next reminder ${sameDay ? 'today' : 'tomorrow'} at ${n.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** Daily health-check checklist: tick each member of a saved list once it has been checked; unticked members are emailed at the reminder times. */
export default function ChecklistView({ groups, defaultEmail, onOpenCustomers }: { groups: WatchGroup[]; defaultEmail?: string | null; onOpenCustomers: () => void }) {
  const { data, error, toggle, saveSettings, testMail, testTeams } = useChecklist(groups);
  const [email, setEmail] = useState('');
  const [time, setTime] = useState('09:00');
  const [teamsUrl, setTeamsUrl] = useState('');
  const [every, setEvery] = useState(3);
  const [from, setFrom] = useState('00:00');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setEmail((cur) => cur || data.email || '');
  }, [data]);

  if (!data) return <div className="skeleton" style={{ height: 260 }} aria-busy>{error && <p className="panel-empty">{error}</p>}</div>;

  const tracked = (name: string) => data.tracked === null || data.tracked.includes(name);
  const total = data.lists.filter((l) => tracked(l.name)).reduce((n, l) => n + l.members.length, 0);
  const done = data.lists.filter((l) => tracked(l.name)).reduce((n, l) => n + l.done.filter((m) => l.members.includes(m)).length, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const emailOk = EMAIL_RE.test(email.trim());
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
    const all = data.lists.map((l) => l.name);
    const cur = data.tracked ?? all;
    void saveSettings({ tracked: on ? [...new Set([...cur, name])] : cur.filter((n) => n !== name) });
  };

  return (
    <div className="cl">
      <section className="panel cl-hero">
        <div className="cl-ring" style={{ ['--p' as string]: `${pct}%` }} aria-hidden>
          <b className="mono">{pct}%</b>
        </div>
        <div className="cl-hero-text">
          <h2>Today's health checks</h2>
          <p className="mono">
            {total === 0 ? 'No lists yet' : `${done} of ${total} checked${done === total ? ' · all done' : ''}`}
          </p>
          <p className="cl-next">{nextLabel(data)}</p>
        </div>
      </section>

      {error && <div className="banner banner-err">{error}</div>}

      {data.lists.length === 0 ? (
        <section className="panel cl-empty">
          <h3>No lists to check yet</h3>
          <p>
            A list is a saved group from the Customers tab, for example <b>Daily HC</b>. Search for the customers you check every day, choose <b>Groups → Save as group</b>,
            and they appear here as a checklist.
          </p>
          <button className="btn-accent" onClick={onOpenCustomers}>
            Go to Customers
          </button>
        </section>
      ) : (
        <div className="cl-lists">
          {data.lists.map((l) => {
            const d = l.done.filter((m) => l.members.includes(m));
            const complete = l.members.length > 0 && d.length === l.members.length;
            return (
              <section key={l.name} className={`panel cl-list${complete ? ' cl-complete' : ''}`} aria-label={l.name}>
                <div className="panel-hd">
                  <h3>{l.name}</h3>
                  <span className="mono cl-count">
                    {d.length}/{l.members.length}
                  </span>
                </div>
                <div className="cl-bar" aria-hidden>
                  <i style={{ width: `${l.members.length ? (d.length / l.members.length) * 100 : 0}%` }} />
                </div>
                <div className="panel-bd">
                  {l.members.length === 0 ? (
                    <p className="panel-empty">This group has no customers.</p>
                  ) : (
                    <ul className="cl-items">
                      {l.members.map((m) => {
                        const on = l.done.includes(m);
                        return (
                          <li key={m}>
                            <label className={`cl-item${on ? ' on' : ''}`}>
                              <input type="checkbox" checked={on} onChange={(e) => void toggle(l.name, m, e.target.checked)} aria-label={`${l.name}: ${m}`} />
                              <span className="cl-box" aria-hidden />
                              <span className="cl-name">{m}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="cl-actions">
                    <button className="pill" disabled={complete || l.members.length === 0} onClick={() => void toggle(l.name, null, true)}>
                      ✓ Mark all done
                    </button>
                    <button className="pill" disabled={d.length === 0} onClick={() => void toggle(l.name, null, false)}>
                      Clear
                    </button>
                    <label className="cl-remind" title="Include this list in the reminder emails">
                      <input type="checkbox" checked={tracked(l.name)} onChange={(e) => setTracked(l.name, e.target.checked)} aria-label={`Remind me about ${l.name}`} />
                      <span>Remind me</span>
                    </label>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="panel cl-mail">
        <div className="panel-hd">
          <h3>Teams reminders</h3>
          <label className="cl-remind">
            <input type="checkbox" checked={data.enabled} onChange={(e) => void saveSettings({ enabled: e.target.checked })} aria-label="Send reminders" />
            <span>{data.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <div className="panel-bd cl-form">
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
                starting at
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
            <small>
              Repeating starts at your first reminder time each day and stops as soon as everything is ticked (or at midnight), so choose a first time you are happy to be messaged at.
            </small>
          </div>



          {/* Email reminders are built (backend + this form) but switched off for now: set SHOW_EMAIL to bring them back. */}
          {SHOW_EMAIL && (
            <>
          <label className="cl-field">
            <span>Your email</span>
            <div className="cl-row">
              <input
                type="email"
                value={email}
                placeholder={defaultEmail ?? 'name@company.com'}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Your email address"
                autoComplete="email"
              />
              <button className="btn-accent" disabled={busy || !emailOk || email.trim() === data.email} onClick={() => void run(() => saveSettings({ email: email.trim() }), 'Email saved.')}>
                Save
              </button>
              {defaultEmail && !email && (
                <button className="pill" onClick={() => setEmail(defaultEmail)}>
                  Use {defaultEmail}
                </button>
              )}
            </div>
            {email && !emailOk && <small className="cl-bad">That does not look like an email address.</small>}
          </label>
          <div className="cl-row">
            <button className="pill" disabled={busy || !data.email || !data.smtp.configured} onClick={() => void run(testMail, `Test email sent to ${data.email}.`)}>
              ✉ Send a test email
            </button>
            {note && <span className={note.ok ? 'cl-ok' : 'cl-bad'} role="status">{note.text}</span>}
          </div>
          {!data.smtp.configured && (
            <div className="banner banner-warm cl-smtp">
              Email is not set up on this server yet, so reminders cannot be sent. Add <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>MAIL_FROM</code> to <code>backend/.env</code> and restart the
              backend (see the README).
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
      </section>
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
