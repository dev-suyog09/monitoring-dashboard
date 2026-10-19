import { useState } from 'react';
import type { NeedsIp } from '../lib/needsIp';
import SidePanel from './SidePanel';

function CopyList({ title, hint, names }: { title: string; hint: string; names: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = names.join(',');
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <section className="mb-5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          {title} · <span className="mono">{names.length}</span>
        </span>
        <button type="button" className="pill" style={{ fontSize: 11, padding: '3px 10px' }} onClick={copy} disabled={names.length === 0}>
          {copied ? '✓ Copied' : '⧉ Copy list'}
        </button>
      </div>
      {names.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ok-fg)' }}>
          None — nothing is blocked by a firewall.
        </p>
      ) : (
        <textarea
          readOnly
          value={text}
          rows={Math.min(8, Math.max(3, Math.ceil(text.length / 48)))}
          onFocus={(e) => e.currentTarget.select()}
          className="mono w-full rounded-xl p-3 text-[11px]"
          style={{ background: 'var(--card-2)', color: 'var(--text-1)', border: '1px solid var(--border)', resize: 'vertical' }}
        />
      )}
      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
        {hint}
      </p>
    </section>
  );
}

/** Side panel: comma-separated, copyable lists of SRD / bot storage accounts blocked by their firewall. */
export default function NeedsIpPanel({
  needs,
  egressIp,
  onClose,
}: {
  needs: NeedsIp;
  egressIp?: string | null;
  onClose: () => void;
}) {
  return (
    <SidePanel
      title="Accounts that need your IP added"
      subtitle={`Blocked by the storage firewall${egressIp ? ` · your IP ${egressIp}` : ''}`}
      onClose={onClose}
      width={460}
    >
      <CopyList title="SRD locations" names={needs.srd} hint="Paste into add-ip-to-srd.ps1 when it asks for the account names." />
      <CopyList
        title="Bot storage accounts"
        names={needs.bot}
        hint="Paste into add-ip-to-botstorage.ps1 (it accepts botstorage names directly)."
      />
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
        Timeouts and other errors are not listed — they are not an IP problem. The scripts skip accounts that are
        private-endpoint only (private endpoints and no IP rules).
      </p>
    </SidePanel>
  );
}
