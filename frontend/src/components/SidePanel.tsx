import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The one pop-up style for the whole dashboard: a glass sidebar that glides in from the right with a blurred
 * backdrop, and slides back out on close (Esc, backdrop click or ✕). Rendered in a portal so it is never
 * clipped by the sticky header's blur.
 */
export default function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 420,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 240); // let the slide-out play first
  }, [closing, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return createPortal(
    <>
      <div className={`drawer-backdrop ${closing ? 'backdrop-out' : ''}`} onClick={close} />
      <aside
        className={`drawer sheet ${closing ? 'drawer-out' : ''}`}
        style={{ width: `min(${width}px, 100%)` }}
        role="dialog"
        aria-label={title}
      >
        <div className="sheet-hd">
          <div style={{ minWidth: 0 }}>
            <div className="sheet-title">{title}</div>
            {subtitle && <div className="sheet-sub">{subtitle}</div>}
          </div>
          <button className="icirc" onClick={close} aria-label="Close" style={{ width: 36, height: 36, flex: 'none' }}>
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-ft">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}
