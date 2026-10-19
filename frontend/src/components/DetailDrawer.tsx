import { useEffect, useState } from 'react';
import type { CheckResult } from '../types';
import { detectEnv, STATUS_META } from '../lib/ui';
import { EnvBadge, StatusBadge, CopyIpChip } from './Badges';
import LatestFiles from './LatestFiles';
import BotStoragePanel from './BotStoragePanel';

function DateChip({ date, today }: { date: string; today: string }) {
  const isToday = date === today;
  return (
    <span
      className="rounded-full px-2 py-0.5 font-mono text-[10px]"
      style={{
        background: isToday ? 'var(--accent)' : 'var(--card-2)',
        color: isToday ? '#1c1b19' : 'var(--text-3)',
        fontWeight: isToday ? 700 : 400,
      }}
    >
      {date}
      {isToday ? ' ✓' : ''}
    </span>
  );
}

export default function DetailDrawer({
  account,
  today,
  egressIp,
  onClose,
}: {
  account: CheckResult;
  today: string;
  egressIp?: string | null;
  onClose: () => void;
}) {
  const env = detectEnv(account.accountName);
  const m = STATUS_META[account.status];
  const cov = account.capturesTotal > 0 ? Math.round((account.capturesWithToday / account.capturesTotal) * 100) : 0;

  const [copied, setCopied] = useState(false);
  const copyName = () => {
    navigator.clipboard?.writeText(account.accountName).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      },
      () => {},
    );
  };

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={`drawer ${m.scope}`} role="dialog" aria-label={`${account.accountName} details`}>
        {/* header */}
        <div className="flex items-start gap-3 p-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg"
            style={{ background: 'color-mix(in srgb, var(--c) 16%, transparent)' }}
          >
            🗄️
          </span>
          <div className="min-w-0 flex-1">
            <button
              onClick={copyName}
              title="Click to copy account name"
              className="flex max-w-full items-center gap-1.5"
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <span className="truncate font-mono text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                {account.accountName}
              </span>
              <span
                className="shrink-0 text-xs"
                style={{ color: copied ? 'var(--ok-fg)' : 'var(--text-3)' }}
              >
                {copied ? '✓ copied' : '⧉'}
              </span>
            </button>
            <div className="mt-1.5 flex items-center gap-2">
              <StatusBadge status={account.status} />
              <EnvBadge env={env} />
            </div>
          </div>
          <button className="icirc" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36 }}>
            ✕
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-6">
          {account.bot && <BotStoragePanel bot={account.bot} />}
          {account.status === 'error' ? (
            <div
              className="rounded-2xl px-4 py-3"
              style={{ background: 'color-mix(in srgb, var(--err) 12%, transparent)' }}
            >
              <p className="text-sm leading-relaxed" style={{ color: 'var(--err-fg)' }}>
                {account.error}
              </p>
              {/allowlisted/i.test(account.error ?? '') && egressIp && (
                <div className="mt-3">
                  <CopyIpChip ip={egressIp} />
                </div>
              )}
            </div>
          ) : (
            <>
              {/* coverage summary */}
              <div className="card p-4" style={{ boxShadow: 'none' }}>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                      Today&apos;s coverage
                    </div>
                    <div className="mt-1 text-2xl font-extrabold" style={{ color: 'var(--c-fg)' }}>
                      {account.capturesWithToday}
                      <span className="text-base font-medium" style={{ color: 'var(--text-3)' }}>
                        {' '}
                        / {account.capturesTotal} folders
                      </span>
                    </div>
                  </div>
                  <div className="text-3xl font-light tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {cov}%
                  </div>
                </div>
                <div className="track mt-3">
                  <span style={{ width: `${cov}%` }} />
                </div>
              </div>

              {/* capture folders */}
              <div className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Capture folders
              </div>
              {account.captureFolders.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                  No capture folders found.
                </p>
              )}
              <div className="flex flex-col gap-2.5">
                {account.captureFolders.map((cf) => (
                  <div key={cf.name} className="rounded-2xl p-3.5" style={{ background: 'var(--card-2)' }}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                        {cf.name}
                      </span>
                      <span className={`chip ${cf.todayExists ? 'st-ok' : 'st-warn'}`}>
                        {cf.todayExists ? 'today ✓' : 'no today'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {cf.recentDates.length === 0 ? (
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                          no date folders
                        </span>
                      ) : (
                        cf.recentDates.map((d) => <DateChip key={d} date={d} today={today} />)
                      )}
                    </div>
                    {/* Latest 5 chat + media files from today's folder (or the newest folder if today is missing). */}
                    {(cf.todayExists || cf.latestDate) && (
                      <LatestFiles
                        account={account.accountName}
                        capture={cf.name}
                        date={cf.todayExists ? today : cf.latestDate!}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
