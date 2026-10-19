import { useEffect, useState } from 'react';
import type { ArchiveFile, FilesResponse } from '../types';
import { fetchFiles } from '../lib/api';

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function FileList({ title, icon, files, total }: { title: string; icon: string; files: ArchiveFile[]; total: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        <span>
          {icon} {title}
        </span>
        <span className="mono">{total} total</span>
      </div>
      {files.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          none
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li
              key={f.name}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-[11px]"
              style={{ background: 'var(--card)' }}
              title={`${f.name} · ${new Date(f.lastModified).toLocaleString()}`}
            >
              <span className="mono truncate" style={{ color: 'var(--text-1)', flex: 1, minWidth: 0 }}>
                {f.name}
              </span>
              <span className="mono shrink-0" style={{ color: 'var(--text-3)' }}>
                {fmtSize(f.sizeBytes)}
              </span>
              <span className="mono shrink-0" style={{ color: 'var(--text-2)' }}>
                {fmtTime(f.lastModified)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Latest 5 .chat + 5 .mp3 files inside archive/{capture}/{date}/.
 * Fetched on mount (on demand), because a day folder can hold ~25k blobs.
 */
export default function LatestFiles({ account, capture, date }: { account: string; capture: string; date: string }) {
  const [data, setData] = useState<FilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to force a fresh listing

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchFiles(account, capture, date, ac.signal, nonce > 0)
      .then(setData)
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [account, capture, date, nonce]);

  return (
    <div className="mt-2.5 rounded-xl p-2.5" style={{ background: 'color-mix(in srgb, var(--card-2) 60%, var(--card))', border: '1px solid var(--border)' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          Latest files · <span className="mono">{date}</span>
        </span>
        <button
          type="button"
          className="pill"
          style={{ fontSize: 10, padding: '2px 8px' }}
          onClick={() => setNonce((n) => n + 1)}
          disabled={loading}
          title="Re-list this folder now"
        >
          {loading ? '⟳ listing…' : data?.cached ? '⟳ cached · refresh' : '⟳ refresh'}
        </button>
      </div>

      {error ? (
        <p className="text-[11px]" style={{ color: 'var(--err-fg)' }}>
          {error}
        </p>
      ) : !data ? (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          Listing folder… (large days take up to a minute)
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <FileList title="Chat (.chat)" icon="💬" files={data.chat} total={data.totals.chat} />
          <FileList title="Media (.mp3)" icon="🎧" files={data.media} total={data.totals.media} />
          {data.totals.other > 0 && (
            <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              + {data.totals.other} other file{data.totals.other === 1 ? '' : 's'} (metadata .json etc., not listed)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
