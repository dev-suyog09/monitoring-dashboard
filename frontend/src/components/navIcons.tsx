/** Small stroke icons for the sidebar and stat cards (UI only). */
const P: Record<string, string> = {
  customers: 'M3 21V7l9-4 9 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  bots: 'M4 6h16v5H4zM4 13h16v5H4zM8 8.5h.01M8 15.5h.01',
  dbs: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  ok: 'M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z',
  warn: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  err: 'M15 9l-6 6M9 9l6 6M12 21a9 9 0 100-18 9 9 0 000 18z',
  idle: 'M5 12h14M12 21a9 9 0 100-18 9 9 0 000 18z',
  total: 'M4 6h16v5H4zM4 13h16v5H4zM8 8.5h.01M8 15.5h.01',
  key: 'M15 7a4 4 0 11-3.9 4.9L4 19v-3H1v-3h3l2-2M15 7h.01',
  refresh: 'M20 11a8 8 0 00-14.9-3M4 4v4h4M4 13a8 8 0 0014.9 3M20 20v-4h-4',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.total} />
    </svg>
  );
}
