import { useEffect, useState } from 'react';
import type { AlertItem } from '../lib/alerts';
import type { Toast } from '../lib/useAlerts';
import SidePanel from './SidePanel';

const shortInstance = (n: string) => n.split('.').pop() ?? n;
const TOAST_MS = 9000;

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function Entry({ i, index, onOpen }: { i: AlertItem; index: number; onOpen: () => void }) {
  const down = i.kind === 'down';
  return (
    <button
      type="button"
      className={`alert-card ${down ? 'st-err' : 'st-ok'} ${i.read ? '' : 'alert-new'}`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      onClick={onOpen}
    >
      <span className="alert-ico">{down ? '⚠' : '✓'}</span>
      <span className="alert-main">
        <span className="alert-title">
          {down ? i.status : 'Recovered'}
          <span className="mono"> · {shortInstance(i.instance)}</span>
        </span>
        <span className="alert-sub mono">{i.cloudService}</span>
        <span className="alert-sub">{i.subscription}</span>
      </span>
      <span className="alert-time">{ago(i.at)}</span>
    </button>
  );
}

/** 🔔 with an unread count; opens a sidebar listing instances that went Stopped / Unresponsive (and recoveries). */
export function NotificationBell({
  items,
  unread,
  onOpenItem,
  onMarkAllRead,
  onClear,
  desktop,
  desktopSupported,
  onEnableDesktop,
  onDisableDesktop,
  sound,
  onToggleSound,
  onPreviewSound,
}: {
  items: AlertItem[];
  unread: number;
  onOpenItem: (item: AlertItem) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
  desktop: boolean;
  desktopSupported: boolean;
  onEnableDesktop: () => void;
  onDisableDesktop: () => void;
  sound: boolean;
  onToggleSound: (on: boolean) => void;
  onPreviewSound: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fresh = items.filter((i) => !i.read);
  const earlier = items.filter((i) => i.read);

  return (
    <>
      <button
        className="icirc bell"
        onClick={() => setOpen(true)}
        title={unread > 0 ? `${unread} unread alert${unread === 1 ? '' : 's'}` : 'Notifications'}
        aria-label="Notifications"
      >
        <span className={unread > 0 ? 'bell-ring' : ''}>🔔</span>
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <SidePanel
          title="Notifications"
          subtitle="Bot instances that went Stopped or Unresponsive"
          onClose={() => setOpen(false)}
          footer={
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="sheet-check">
                  <input type="checkbox" checked={sound} onChange={(e) => onToggleSound(e.target.checked)} />
                  Play a chime for new alerts
                </label>
                <button type="button" className="pill" style={{ fontSize: 11, padding: '4px 12px' }} onClick={onPreviewSound} title="Hear the alert tone">
                  ▶ Preview
                </button>
              </div>
              {desktopSupported && (
                <label className="sheet-check">
                  <input type="checkbox" checked={desktop} onChange={(e) => (e.target.checked ? onEnableDesktop() : onDisableDesktop())} />
                  Desktop notifications while this tab is in the background
                </label>
              )}
            </div>
          }
        >
          <div className="sheet-actions">
            <button type="button" className="pill" onClick={onMarkAllRead} disabled={unread === 0}>
              ✓ Mark all read
            </button>
            <button type="button" className="pill" onClick={onClear} disabled={items.length === 0}>
              Clear
            </button>
          </div>

          {items.length === 0 ? (
            <div className="sheet-empty">
              <div className="sheet-empty-ico">🔔</div>
              <p>You're all caught up.</p>
              <p className="sheet-empty-sub">
                You'll be notified here when a bot instance goes <strong>Stopped</strong> or <strong>Unresponsive</strong> after a check.
              </p>
            </div>
          ) : (
            <>
              {fresh.length > 0 && <div className="sheet-group">New · {fresh.length}</div>}
              {fresh.map((i, n) => (
                <Entry
                  key={i.id}
                  i={i}
                  index={n}
                  onOpen={() => {
                    setOpen(false);
                    onOpenItem(i);
                  }}
                />
              ))}
              {earlier.length > 0 && <div className="sheet-group">Earlier</div>}
              {earlier.map((i, n) => (
                <Entry
                  key={i.id}
                  i={i}
                  index={fresh.length + n}
                  onOpen={() => {
                    setOpen(false);
                    onOpenItem(i);
                  }}
                />
              ))}
            </>
          )}
        </SidePanel>
      )}
    </>
  );
}

/** Pop-ups in the top-right corner: glass cards that glide in, count down with a progress bar, and click through. */
export function Toasts({
  toasts,
  onClose,
  onOpen,
}: {
  toasts: Toast[];
  onClose: (id: string) => void;
  onOpen: () => void;
}) {
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => onClose(t.id), TOAST_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, onClose]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast st-err"
          role="alert"
          onClick={() => {
            onOpen();
            onClose(t.id);
          }}
        >
          <span className="toast-ico">⚠</span>
          <span className="toast-text">
            <span className="toast-title">{t.title}</span>
            <span className="toast-body mono">{t.body}</span>
            <span className="toast-hint">Click to open Cloud Instances</span>
          </span>
          <button
            type="button"
            className="toast-x"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            ✕
          </button>
          <span className="toast-bar" style={{ animationDuration: `${TOAST_MS}ms` }} />
        </div>
      ))}
    </div>
  );
}
