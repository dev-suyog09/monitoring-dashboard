import { useEffect, useRef, useState } from 'react';
import type { WatchGroup } from '../lib/watchlist';
import SidePanel from './SidePanel';

export interface CustomerSuggestion {
  /** Customer code, e.g. "adc". */
  code: string;
  /** e.g. "1 SRD · 3 bots · 3 dbs". */
  detail: string;
}

/**
 * Multi-customer search. As you type, the page filters live to every customer STARTING with what you typed and a
 * suggestion list opens under the box; click one (or arrow keys + Enter) to add it as a chip. Enter on a partial name
 * adds a prefix chip like "n*". Results match ANY chip (union). Save the set as a named group, or recall one.
 */
export default function WatchlistSearch({
  terms,
  setTerms,
  groups,
  setGroups,
  matchCount,
  suggestions,
  onDraft,
}: {
  terms: string[];
  setTerms: (t: string[]) => void;
  groups: WatchGroup[];
  setGroups: (g: WatchGroup[]) => void;
  matchCount: number;
  /** Every known customer, for the dropdown. */
  suggestions: CustomerSuggestion[];
  /** Called on every keystroke so the page can filter live. */
  onDraft: (text: string) => void;
}) {
  const [draft, setDraftState] = useState('');
  const [hi, setHi] = useState(-1); // highlighted suggestion
  const [focus, setFocus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const setDraft = (v: string) => {
    setDraftState(v);
    setHi(-1);
    onDraft(v);
  };

  const q = draft.trim().toLowerCase();
  const matches = q ? suggestions.filter((s) => s.code.startsWith(q)).slice(0, 14) : [];
  const exact = suggestions.some((s) => s.code === q);

  const addTerm = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (t && !terms.includes(t)) setTerms([...terms, t]);
    setDraft('');
  };
  const removeTerm = (t: string) => setTerms(terms.filter((x) => x !== t));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setHi((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setHi((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setDraft('');
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (!q) return;
      if (hi >= 0 && matches[hi]) addTerm(matches[hi]!.code);
      else if (exact) addTerm(q);
      else addTerm(`${q.replace(/\*+$/, '')}*`); // partial name -> "n*" = everything starting with n
    } else if (e.key === 'Backspace' && !draft && terms.length) {
      removeTerm(terms[terms.length - 1]!);
    }
  };

  const [saveOpen, setSaveOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const saveAsGroup = () => {
    if (!terms.length) return;
    setGroupName('');
    setSaveOpen(true);
  };
  const commitGroup = () => {
    const name = groupName.trim();
    if (!name) return;
    const next = [...groups.filter((g) => g.name !== name), { name, terms: [...terms] }].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    setGroups(next);
    setSaveOpen(false);
  };
  const loadGroup = (g: WatchGroup) => {
    setTerms([...g.terms]);
    setMenuOpen(false);
  };
  const deleteGroup = (name: string) => setGroups(groups.filter((g) => g.name !== name));

  // Close the group menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  return (
    <div className="wl-wrap">
      <div className="wl-field">
      <div className="wl" onClick={() => inputRef.current?.focus()}>
        <span className="wl-ico" aria-hidden style={{ color: 'var(--text-3)', fontSize: 13 }}>🔍</span>
        {terms.map((t) => (
          <span key={t} className="wchip">
            {t}
            <button type="button" onClick={() => removeTerm(t)} aria-label={`Remove ${t}`}>
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 120)}
          placeholder={terms.length ? 'add customer…' : 'search customers… type a letter, e.g. n, adc, atd'}
          autoComplete="off"
          spellCheck={false}
        />
        {(terms.length > 0 || q) && (
          <span className="wl-count">{matchCount} match{matchCount === 1 ? '' : 'es'}</span>
        )}
      </div>

      {focus && q && (
        <div className="wl-suggest" role="listbox">
          {matches.length === 0 ? (
            <div className="wl-empty">No customer starts with “{draft.trim()}”.</div>
          ) : (
            <>
              <div className="wl-suggest-hd">
                {matches.length === 14 ? '14+' : matches.length} customer{matches.length === 1 ? '' : 's'} starting with “{q}” — click to add
              </div>
              {matches.map((s, i) => (
                <button
                  key={s.code}
                  type="button"
                  role="option"
                  aria-selected={i === hi}
                  className={`wl-suggest-item ${i === hi ? 'wl-suggest-on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => addTerm(s.code)}
                >
                  <span className="mono wl-suggest-code">{s.code.toUpperCase()}</span>
                  <span className="wl-suggest-detail">{s.detail}</span>
                </button>
              ))}
              <div className="wl-suggest-ft">Enter on “{q}” adds <span className="mono">{q}*</span> (everything starting with it)</div>
            </>
          )}
        </div>
      )}
      </div>

      <div className="wl-actions">
        {terms.length > 0 && (
          <>
            <button className="pill" type="button" onClick={saveAsGroup} title="Save these customers as a named group">
              ★ Save group
            </button>
            <button className="pill" type="button" onClick={() => setTerms([])} title="Clear watchlist">
              Clear
            </button>
          </>
        )}
        <div className="wl-menu" ref={menuRef}>
          <button className="pill" type="button" onClick={() => setMenuOpen((o) => !o)} title="Saved groups">
            Groups {groups.length > 0 ? `(${groups.length})` : ''} ▾
          </button>
          {menuOpen && (
            <div className="wl-dropdown">
              {groups.length === 0 ? (
                <div className="wl-empty">No saved groups yet. Add some customers, then “Save group”.</div>
              ) : (
                groups.map((g) => (
                  <div key={g.name} className="wl-item">
                    <button type="button" className="wl-item-main" onClick={() => loadGroup(g)}>
                      <span className="wl-item-name">{g.name}</span>
                      <span className="wl-item-terms">{g.terms.length} customer{g.terms.length === 1 ? '' : 's'}</span>
                    </button>
                    <button
                      type="button"
                      className="wl-item-del"
                      onClick={() => deleteGroup(g.name)}
                      aria-label={`Delete group ${g.name}`}
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {saveOpen && (
        <SidePanel
          title="Save group"
          subtitle="Name this set of customers so you can recall it later"
          width={400}
          onClose={() => setSaveOpen(false)}
          footer={
            <div className="sheet-buttons">
              <button className="pill" onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
              <button className="btn-accent" disabled={!groupName.trim()} onClick={commitGroup}>
                ★ Save group
              </button>
            </div>
          }
        >
          <label className="sheet-label" htmlFor="group-name">
            Group name
          </label>
          <input
            id="group-name"
            className="sheet-input"
            autoFocus
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitGroup()}
            placeholder="e.g. UAE banks, My top customers"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="sheet-label" style={{ marginTop: 18 }}>
            Includes {terms.length} customer{terms.length === 1 ? '' : 's'}
          </div>
          <div className="flex flex-wrap gap-2">
            {terms.map((t) => (
              <span key={t} className="wchip">
                {t}
              </span>
            ))}
          </div>
        </SidePanel>
      )}
    </div>
  );
}
