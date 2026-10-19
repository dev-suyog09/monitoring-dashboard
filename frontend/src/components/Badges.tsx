import { useState } from 'react';
import type { BotStorageResult, Status } from '../types';
import { STATUS_META, type EnvKind } from '../lib/ui';

export function EnvBadge({ env }: { env: EnvKind }) {
  return <span className={`chip en-${env}`}>{env}</span>;
}

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className={`chip ${m.scope}`}>
      <span className={`dot ${status === 'healthy' ? 'pulse' : ''}`} />
      {m.label}
    </span>
  );
}

/** Click-to-copy IP chip (span, so it can live inside a card <button>). */
export function CopyIpChip({ ip }: { ip: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard?.writeText(ip).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      },
      () => {},
    );
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={copy}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && copy(e as unknown as React.MouseEvent)}
      className="chip st-idle"
      style={{ cursor: 'pointer', fontFamily: 'monospace' }}
      title="Copy IP to clipboard"
    >
      {copied ? '✓ Copied' : `⧉ ${ip}`}
    </span>
  );
}

/** Warning chip shown only when bot storage has stuck interactions (or couldn't be checked). */
export function BotChip({ bot }: { bot?: BotStorageResult }) {
  if (!bot || (bot.status !== 'stuck' && bot.status !== 'error')) return null;
  const stuck = bot.status === 'stuck';
  return (
    <span
      className={`chip ${stuck ? 'st-err' : 'st-warn'}`}
      title={stuck ? `${bot.stuckCount} interaction(s) stuck in bot storage` : 'Bot storage could not be checked'}
    >
      {stuck ? `⚠ ${bot.stuckCount} stuck in bot storage` : '⚠ bot storage unchecked'}
    </span>
  );
}
