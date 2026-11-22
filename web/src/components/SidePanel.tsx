import { useState } from 'react';
import type { Bookmark, Highlight } from '../lib/api';
import type { TocItem } from '../readers/types';

export type PanelTab = 'toc' | 'bookmarks' | 'highlights';

interface Props {
  initialTab: PanelTab;
  toc: TocItem[];
  bookmarks: Bookmark[];
  highlights: Highlight[];
  isPdf: boolean;
  onGo: (location: string) => void;
  onDeleteBookmark: (id: string) => void;
  onEditHighlight: (h: Highlight) => void;
  onClose: () => void;
}

function TocList({ items, onGo, depth = 0 }: { items: TocItem[]; onGo: (l: string) => void; depth?: number }) {
  return (
    <ul className="toc">
      {items.map((it, i) => (
        <li key={`${it.location}-${i}`}>
          <button className="list-btn" style={{ paddingLeft: 16 + depth * 16 }} onClick={() => onGo(it.location)}>
            {it.label}
          </button>
          {it.children && <TocList items={it.children} onGo={onGo} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function SidePanel(p: Props) {
  const [tab, setTab] = useState<PanelTab>(p.initialTab);

  return (
    <>
      <div className="scrim" onClick={p.onClose} />
      <aside className="sheet sheet-side" role="dialog" aria-label="Navegação">
        <div className="sheet-head">
          <div className="segmented">
            <button aria-selected={tab === 'toc'} onClick={() => setTab('toc')}>
              Sumário
            </button>
            <button aria-selected={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>
              Marcadores{p.bookmarks.length ? ` · ${p.bookmarks.length}` : ''}
            </button>
            <button aria-selected={tab === 'highlights'} onClick={() => setTab('highlights')}>
              Destaques{p.highlights.length ? ` · ${p.highlights.length}` : ''}
            </button>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          {tab === 'toc' &&
            (p.toc.length ? (
              <TocList items={p.toc} onGo={p.onGo} />
            ) : (
              <p className="muted pad">Este livro não tem sumário.</p>
            ))}

          {tab === 'bookmarks' &&
            (p.bookmarks.length ? (
              <ul className="notes">
                {p.bookmarks.map((b) => (
                  <li key={b.id} className="note">
                    <button className="list-btn" onClick={() => p.onGo(b.location)}>
                      <span className="note-icon" aria-hidden>
                        🔖
                      </span>
                      <span>{b.label || 'Marcador'}</span>
                    </button>
                    <button className="icon-btn small" aria-label="Apagar marcador" onClick={() => p.onDeleteBookmark(b.id)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted pad">Toque em 🔖 na barra de cima para marcar a página atual.</p>
            ))}

          {tab === 'highlights' &&
            (p.highlights.length ? (
              <ul className="notes">
                {p.highlights.map((h) => (
                  <li key={h.id} className="note">
                    <button className="list-btn hl-item" onClick={() => p.onGo(h.location)}>
                      <span className={`hl-quote hl-border-${h.color}`}>“{h.text}”</span>
                      {h.note && <span className="hl-note">{h.note}</span>}
                      {p.isPdf && <span className="muted small">Página {h.location}</span>}
                    </button>
                    <button className="icon-btn small" aria-label="Editar destaque" onClick={() => p.onEditHighlight(h)}>
                      ✎
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted pad">Selecione um trecho do texto para destacar.</p>
            ))}
        </div>
      </aside>
    </>
  );
}
