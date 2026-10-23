import type { ReactNode } from 'react';
import SidePanel from './SidePanel';
import { THEMES, type Mode } from '../lib/theme';
import { ACCENTS, resetSettings, updateSettings, type Settings } from '../lib/settings';
import { playChime, TUNES } from '../lib/chime';

function Group({ icon, title, hint, children }: { icon: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      <div className="set-group-hd">
        <span className="cd-ico">{icon}</span>
        <div>
          <h4>{title}</h4>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      <div className="set-group-bd">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="set-row-ctl">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'switch-on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'seg-on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPanel({
  settings,
  mode,
  setMode,
  alerts,
  account,
  onClose,
}: {
  settings: Settings;
  mode: Mode;
  setMode: (m: Mode) => void;
  alerts: {
    sound: boolean;
    toggleSound: (on: boolean) => void;
    previewSound: () => void;
    desktop: boolean;
    desktopSupported: boolean;
    enableDesktop: () => void;
    disableDesktop: () => void;
    clear: () => void;
    count: number;
  };
  account: { name: string | null; email: string | null; egressIp: string | null | undefined; backendStarted: string | null };
  onClose: () => void;
}) {
  const set = updateSettings;
  return (
    <SidePanel title="Settings" subtitle="Saved in this browser — nothing here changes the monitored systems" onClose={onClose} width={560}>
      <Group icon="🎨" title="Appearance" hint="Pick a theme — it applies instantly">
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} type="button" className={`theme-card ${mode === t.id ? 'theme-on' : ''}`} onClick={() => setMode(t.id)} aria-pressed={mode === t.id}>
              <span className="theme-swatch" style={{ background: t.swatch[0] }}>
                <i style={{ background: t.swatch[1] }} />
                <i style={{ background: t.swatch[2] }} />
              </span>
              <span className="theme-name">{t.label}</span>
              <span className="theme-blurb">{t.blurb}</span>
              {mode === t.id && <span className="theme-check">✓</span>}
            </button>
          ))}
        </div>
        <Row label="Accent colour" hint="Overrides the theme's highlight colour">
          <div className="accents">
            {ACCENTS.map((a) => (
              <button
                key={a.id || 'default'}
                type="button"
                title={a.label}
                aria-label={a.label}
                aria-pressed={settings.accent === a.id}
                className={`accent-dot ${settings.accent === a.id ? 'accent-on' : ''} ${a.id === '' ? 'accent-default' : ''}`}
                style={a.a ? { background: `linear-gradient(135deg, ${a.a}, ${a.b})` } : undefined}
                onClick={() => set({ accent: a.id })}
              >
                {a.id === '' ? '∅' : ''}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Density" hint="Compact fits more rows on screen">
          <Segmented value={settings.density} onChange={(v) => set({ density: v })} options={[{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]} />
        </Row>
        <Row label="Reduce motion" hint="Turns off entry animations, count-ups and pulsing">
          <Toggle on={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Reduce motion" />
        </Row>
        <Row label="3D charts" hint="Solid exploded pie charts, raised bars and a ribbon line. Off keeps the flat charts">
          <Toggle on={settings.charts3d} onChange={(v) => set({ charts3d: v })} label="3D charts" />
        </Row>
        <Row label="Greeting" hint='Show "Good morning, name!" in the page header'>
          <Toggle on={settings.greeting} onChange={(v) => set({ greeting: v })} label="Show greeting" />
        </Row>
      </Group>

      <Group icon="🧭" title="Navigation">
        <Row label="Sidebar" hint="Hidden and hover modes give the content the full width">
          <Segmented
            value={settings.sidebar}
            onChange={(v) => set({ sidebar: v })}
            options={[
              { id: 'pinned', label: 'Always show' },
              { id: 'hover', label: 'On hover' },
              { id: 'hidden', label: 'Hide' },
            ]}
          />
        </Row>
        <Row label="Open on" hint="The tab shown when the dashboard loads">
          <select className="set-select" value={settings.defaultTab} onChange={(e) => set({ defaultTab: e.target.value as Settings['defaultTab'] })}>
            <option value="customers">Customers</option>
            <option value="archive">Archive</option>
            <option value="bots">Cloud Instances</option>
            <option value="dbs">Databases</option>
          </select>
        </Row>
      </Group>

      <Group icon="🔄" title="Data and refresh">
        <Row label="Auto re-check" hint="How often a full check re-runs once the page is open">
          <select className="set-select" value={settings.autoMinutes} onChange={(e) => set({ autoMinutes: Number(e.target.value) })}>
            <option value={0}>Off</option>
            <option value={5}>Every 5 minutes</option>
            <option value={10}>Every 10 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
            <option value={60}>Every hour</option>
          </select>
        </Row>
        <Row label="Open charts automatically" hint="Show the charts section on every tab without clicking">
          <Toggle on={settings.autoCharts} onChange={(v) => set({ autoCharts: v })} label="Open charts automatically" />
        </Row>
      </Group>

      <Group icon="🔔" title="Notifications" hint="Alerts fire when an instance leaves the Started state">
        <Row label="Play a sound" hint="With each new alert (the browser needs one click on the page first)">
          <Toggle on={alerts.sound} onChange={alerts.toggleSound} label="Play a sound with alerts" />
        </Row>
        <div className={`tune-block ${alerts.sound ? '' : 'tune-off'}`}>
          <div className="tune-grid" role="radiogroup" aria-label="Alert tune">
            {TUNES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={settings.tune === t.id}
                className={`tune-card ${settings.tune === t.id ? 'tune-on' : ''}`}
                onClick={() => {
                  set({ tune: t.id });
                  playChime(t.id);
                }}
              >
                <span className="tune-play" aria-hidden>
                  ▶
                </span>
                <span className="tune-text">
                  <b>{t.label}</b>
                  <small>{t.blurb}</small>
                </span>
                {settings.tune === t.id && <span className="tune-tick">✓</span>}
              </button>
            ))}
          </div>
          <label className="vol-row">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.volume}
              onChange={(e) => set({ volume: Number(e.target.value) })}
              onPointerUp={() => playChime()}
              onKeyUp={() => playChime()}
              aria-label="Alert volume"
              style={{ ['--pct' as string]: `${settings.volume}%` }}
            />
            <b className="mono">{settings.volume}%</b>
          </label>
        </div>
        <Row label="Desktop notifications" hint={alerts.desktopSupported ? 'Shown when the dashboard window is not focused' : 'Not supported by this browser'}>
          <Toggle on={alerts.desktop} onChange={(v) => (v ? alerts.enableDesktop() : alerts.disableDesktop())} label="Desktop notifications" />
        </Row>
        <Row label="Alert history" hint={`${alerts.count} entr${alerts.count === 1 ? 'y' : 'ies'} in the bell`}>
          <button type="button" className="pill" onClick={alerts.clear} disabled={alerts.count === 0}>
            Clear
          </button>
        </Row>
      </Group>

      <Group icon="⌨️" title="Keyboard shortcuts">
        <ul className="kbd-list">
          <li><kbd>Ctrl</kbd> <kbd>K</kbd><span>Jump to search</span></li>
          <li><kbd>Esc</kbd><span>Close a panel</span></li>
          <li><kbd>F11</kbd><span>Full screen</span></li>
        </ul>
      </Group>

      <Group icon="👤" title="Account and about">
        <Row label="Signed in as" hint="The Azure identity the backend reads data with">
          <span className="set-val">{account.email ?? '—'}</span>
        </Row>
        <Row label="Backend address" hint="The public IP Azure sees (the one firewalls must allow)">
          <span className="set-val mono">{account.egressIp ?? '—'}</span>
        </Row>
        <Row label="Backend started">
          <span className="set-val mono">{account.backendStarted ? new Date(account.backendStarted).toLocaleString() : '—'}</span>
        </Row>
        <Row label="Reset settings" hint="Back to the defaults (the theme is kept)">
          <button type="button" className="pill" onClick={resetSettings}>
            ↺ Reset
          </button>
        </Row>
      </Group>
    </SidePanel>
  );
}
