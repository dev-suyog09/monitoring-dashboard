import { Panel } from './panels';

export interface AttentionItem {
  key: string;
  title: string;
  sub: string;
  /** Two-letter badge. */
  badge: string;
  pills: { text: string; scope: string }[];
  onClick: () => void;
}

/** "Needs attention" panel: the worst items first, each with coloured status pills; click to focus on it. */
export default function AttentionList({ items, empty, total }: { items: AttentionItem[]; empty: string; total?: number }) {
  return (
    <Panel
      title="Needs attention"
      right={<span className="panel-legend">{items.length === 0 ? 'all clear' : total && total > items.length ? `top ${items.length} of ${total}` : `top ${items.length}`}</span>}
      bodyClass="panel-bd-flush"
    >
      {items.length === 0 ? (
        <p className="panel-empty">{empty}</p>
      ) : (
        <ul className="att-list">
          {items.map((a) => (
            <li key={a.key}>
              <button type="button" className="att-item" onClick={a.onClick}>
                <span className="cust-av">{a.badge}</span>
                <span className="att-text">
                  <b>{a.title}</b>
                  <span className="att-sub mono">{a.sub}</span>
                </span>
                <span className="att-pills">
                  {a.pills.map((p) => (
                    <span key={p.text} className={`spill ${p.scope}`}>
                      {p.text}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
