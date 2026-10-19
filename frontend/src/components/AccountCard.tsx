import type { CheckResult } from '../types';
import { detectEnv, STATUS_META } from '../lib/ui';
import { EnvBadge, StatusBadge, CopyIpChip, BotChip } from './Badges';

export default function AccountCard({
  account,
  egressIp,
  onSelect,
}: {
  account: CheckResult;
  egressIp?: string | null;
  onSelect: (account: CheckResult) => void;
}) {
  const isFirewall = !!account.error && /allowlisted/i.test(account.error);
  const env = detectEnv(account.accountName);
  const m = STATUS_META[account.status];
  const isError = account.status === 'error';
  const cov = account.capturesTotal > 0 ? Math.round((account.capturesWithToday / account.capturesTotal) * 100) : 0;

  return (
    <button
      onClick={() => onSelect(account)}
      className={`card ${m.scope} fade-up flex flex-col gap-3.5 p-5 text-left`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl text-sm"
            style={{ background: 'color-mix(in srgb, var(--c) 16%, transparent)' }}
          >
            🗄️
          </span>
          <span
            className="truncate font-mono text-[13px] font-bold"
            style={{ color: 'var(--text-1)', maxWidth: 150 }}
            title={account.accountName}
          >
            {account.accountName}
          </span>
        </div>
        <EnvBadge env={env} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={account.status} />
        {!isError && account.status !== 'no_data' && (
          <span className="font-mono text-sm font-bold tabular-nums" style={{ color: 'var(--c-fg)' }}>
            {account.capturesWithToday}/{account.capturesTotal}
          </span>
        )}
      </div>

      {account.bot && (account.bot.status === 'stuck' || account.bot.status === 'error') && (
        <div>
          <BotChip bot={account.bot} />
        </div>
      )}

      {isError ? (
        <div
          className="rounded-2xl px-3 py-2.5"
          style={{ background: 'color-mix(in srgb, var(--err) 12%, transparent)' }}
        >
          <p className="line-clamp-2 text-xs leading-snug" style={{ color: 'var(--err-fg)' }}>
            {account.error}
          </p>
          {isFirewall && egressIp && (
            <div className="mt-2">
              <CopyIpChip ip={egressIp} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="track">
            <span style={{ width: `${cov}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-3)' }}>
            <span>
              {account.capturesTotal} capture folder{account.capturesTotal !== 1 ? 's' : ''}
            </span>
            <span className="font-semibold" style={{ color: 'var(--c-fg)' }}>
              View details →
            </span>
          </div>
        </>
      )}
    </button>
  );
}
