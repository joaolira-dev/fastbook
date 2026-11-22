import { useEffect, useRef, useState } from 'react';
import type { Bookmark, Highlight } from '../lib/api';
import type { SearchHit, TocItem } from '../readers/types';
import { Icon } from './Icon';

export type PanelTab = 'toc' | 'bookmarks' | 'highlights' | 'search';

export interface SearchState {
  query: string;
  hits: SearchHit[];
  busy: boolean;
  done: boolean;
}

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
  search: SearchState;
  onSearch: (q: string) => void;
  onGoHit: (hit: SearchHit) => void;
}

function highlightMatch(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const at = fold(text).indexOf(fold(q));
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

function SearchTab({ state, onSearch, onGoHit }: { state: SearchState; onSearch: (q: string) => void; onGoHit: (h: SearchHit) => void }) {
  const [q, setQ] = useState(state.query);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="search-tab">
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(q);
        }}
      >
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar no livro (Enter)"
          aria-label="Buscar no livro"
        />
      </form>
      {state.busy && <p className="muted small pad-x">Procurando… {state.hits.length > 0 && `${state.hits.length} até agora`}</p>}
      {!state.busy && state.done && (
        <p className="muted small pad-x">
          {state.hits.length ? `${state.hits.length}${state.hits.length >= 300 ? '+' : ''} resultado${state.hits.length > 1 ? 's' : ''}` : 'Nada encontrado.'}
        </p>
      )}
      <ul className="notes">
        {state.hits.map((h, i) => (
          <li key={`${h.location}-${i}`}>
            <button className="list-btn hl-item" onClick={() => onGoHit(h)}>
              {h.label && <span className="eyebrow small-eyebrow">{h.label}</span>}
              <span className="search-excerpt">{highlightMatch(h.excerpt, state.query)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
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
            <button aria-selected={tab === 'search'} onClick={() => setTab('search')} aria-label="Buscar" title="Buscar (/)">
              <Icon name="search" size={16} />
            </button>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>

        <div className="sheet-body">
          {tab === 'search' && <SearchTab state={p.search} onSearch={p.onSearch} onGoHit={p.onGoHit} />}

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
