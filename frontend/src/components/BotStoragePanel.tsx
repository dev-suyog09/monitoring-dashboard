import type { BotAccountResult, BotInteraction, BotStorageResult } from '../types';

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
}

function fmtAge(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function Interaction({ i }: { i: BotInteraction }) {
  return (
    <li className="rounded-xl p-2.5" style={{ background: 'var(--card)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="mono truncate text-[11px] font-semibold" style={{ color: 'var(--text-1)' }} title={i.id}>
          {i.id}
        </span>
        <span className={`chip ${i.stuck ? 'st-err' : 'st-warn'}`}>{i.stuck ? 'stuck' : 'in progress'}</span>
      </div>
      <div className="mono mt-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
        last modified {fmtWhen(i.newestModified)} ({fmtAge(i.newestModified)}) · {i.fileCount} file
        {i.fileCount === 1 ? '' : 's'} · {fmtSize(i.totalBytes)}
      </div>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {i.files.map((f) => (
          <li key={f.name} className="mono flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-2)' }}>
            <span className="truncate" style={{ flex: 1, minWidth: 0 }} title={f.name}>
              {f.name}
            </span>
            <span className="shrink-0" style={{ color: 'var(--text-3)' }}>
              {fmtSize(f.sizeBytes)}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Account({ a, days }: { a: BotAccountResult; days: number }) {
  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="mono truncate text-[11px]" style={{ color: 'var(--text-2)' }} title={a.accountName}>
          {a.accountName}
        </span>
        <span className="mono text-[10px]" style={{ color: 'var(--text-3)' }}>
          {a.totalInteractions} folder{a.totalInteractions === 1 ? '' : 's'} in container
        </span>
      </div>
      {a.status === 'error' && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--err-fg)' }}>
          Could not check: {a.error}
        </p>
      )}
      {a.interactions.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-[11px] font-semibold" style={{ color: 'var(--c-fg)' }}>
            {a.stuckCount} stuck interaction{a.stuckCount === 1 ? '' : 's'} · last {days} days · latest → oldest
          </summary>
          <ul className="mt-1.5 flex flex-col gap-2">
            {a.interactions.map((i) => (
              <Interaction key={i.id} i={i} />
            ))}
          </ul>
          {a.stuckCount > a.interactions.length && (
            <p className="mt-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
              Showing the latest {a.interactions.length} of {a.stuckCount}.
            </p>
          )}
        </details>
      )}
      {a.olderCount > 0 && (
        <p className="mt-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
          + {a.olderCount} older than {days} days not shown
        </p>
      )}
      {a.truncated && (
        <p className="mt-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
          Container too large to read fully — list may be incomplete
        </p>
      )}
    </div>
  );
}

/**
 * Bot storage should be empty: interactions are moved to the archive once processed.
 * Anything left in `audio-video` past the threshold is stuck and shown as a warning.
 */
export default function BotStoragePanel({ bot }: { bot: BotStorageResult }) {
  if (bot.status === 'none') return null;
  const stuck = bot.status === 'stuck';
  const err = bot.status === 'error';
  const tone = stuck ? 'st-err' : err ? 'st-warn' : 'st-ok';
  const shown = bot.accounts.filter((a) => a.status !== 'clean' || a.interactions.length > 0 || a.olderCount > 0 || a.truncated);
  return (
    <div
      className={`mb-5 rounded-2xl p-4 ${tone}`}
      style={{
        background: 'color-mix(in srgb, var(--c) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--c) 35%, transparent)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--c-fg)' }}>
          {stuck ? '⚠ Stuck in bot storage' : err ? '⚠ Bot storage not checked' : '✓ Bot storage clean'}
        </span>
        <span className="mono text-[10px]" style={{ color: 'var(--text-3)' }}>
          {bot.container}
        </span>
      </div>
      <p className="mt-1 text-xs leading-snug" style={{ color: 'var(--text-2)' }}>
        {stuck
          ? `${bot.stuckCount} interaction${bot.stuckCount === 1 ? '' : 's'} from the last ${bot.windowDays} days not cleared for over ${bot.stuckAfterMinutes} min. Nothing should remain here.`
          : err
            ? 'One or more bot storage accounts could not be read.'
            : `No stuck interactions in the last ${bot.windowDays} days.${bot.olderCount > 0 ? ` (${bot.olderCount} older not shown)` : ''}`}
      </p>
      {shown.map((a) => (
        <Account key={a.accountName} a={a} days={bot.windowDays} />
      ))}
    </div>
  );
}
