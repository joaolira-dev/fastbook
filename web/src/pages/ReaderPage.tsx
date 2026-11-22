import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Book, type Bookmark, type Highlight, type HighlightColor } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { useProgressSync } from '../lib/useProgressSync';
import { HIGHLIGHT_FILL, type ReaderHandle, type ReaderLocation, type SelectionInfo, type TocItem } from '../readers/types';
import { SettingsPanel } from '../components/SettingsPanel';
import { SidePanel, type PanelTab } from '../components/SidePanel';
import { Popover } from '../components/Popover';

const EpubReader = lazy(() => import('../readers/EpubReader').then((m) => ({ default: m.EpubReader })));
const PdfReader = lazy(() => import('../readers/PdfReader').then((m) => ({ default: m.PdfReader })));

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
const COLOR_NAMES: Record<HighlightColor, string> = { yellow: 'Amarelo', green: 'Verde', blue: 'Azul', pink: 'Rosa' };

export function ReaderPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { prefs } = usePrefs();
  const readerRef = useRef<ReaderHandle>(null);

  const book = useQuery({ queryKey: ['book', id], queryFn: () => api<Book>(`/books/${id}`) });
  const bookmarks = useQuery({ queryKey: ['bookmarks', id], queryFn: () => api<Bookmark[]>(`/books/${id}/bookmarks`) });
  const highlights = useQuery({ queryKey: ['highlights', id], queryFn: () => api<Highlight[]>(`/books/${id}/highlights`) });
  const sync = useProgressSync(id);

  const [toc, setToc] = useState<TocItem[]>([]);
  const [loc, setLoc] = useState<ReaderLocation | null>(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<PanelTab | 'settings' | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = (key: string) => qc.invalidateQueries({ queryKey: [key, id] });

  const addBookmark = useMutation({
    mutationFn: (b: { location: string; label: string }) => api<Bookmark>(`/books/${id}/bookmarks`, { method: 'POST', json: b }),
    onSuccess: () => invalidate('bookmarks'),
  });
  const delBookmark = useMutation({
    mutationFn: (bmId: string) => api(`/books/${id}/bookmarks/${bmId}`, { method: 'DELETE' }),
    onSuccess: () => invalidate('bookmarks'),
  });
  const addHighlight = useMutation({
    mutationFn: (h: { location: string; text: string; color: HighlightColor }) =>
      api<Highlight>(`/books/${id}/highlights`, { method: 'POST', json: h }),
    onSuccess: (h) => {
      qc.setQueryData<Highlight[]>(['highlights', id], (old) => [...(old ?? []), h]);
    },
  });
  const patchHighlight = useMutation({
    mutationFn: (h: { id: string; color?: HighlightColor; note?: string | null }) =>
      api<Highlight>(`/books/${id}/highlights/${h.id}`, { method: 'PATCH', json: { color: h.color, note: h.note } }),
    onSuccess: (h) => qc.setQueryData<Highlight[]>(['highlights', id], (old) => old?.map((x) => (x.id === h.id ? h : x))),
  });
  const delHighlight = useMutation({
    mutationFn: (hlId: string) => api(`/books/${id}/highlights/${hlId}`, { method: 'DELETE' }),
    onSuccess: (_r, hlId) => qc.setQueryData<Highlight[]>(['highlights', id], (old) => old?.filter((x) => x.id !== hlId)),
  });

  // Se o leitor remontar, reabre na última posição vista (e não na que veio do servidor ao abrir)
  const lastLocation = useRef<string | null>(null);
  const onLocation = useCallback(
    (l: ReaderLocation) => {
      lastLocation.current = l.location;
      setLoc(l);
      sync.report(l.location, l.percent);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sync.report],
  );

  const onSelection = useCallback((s: SelectionInfo | null) => setSelection(s && s.text ? s : null), []);
  const onHighlightClick = useCallback((h: Highlight) => setEditing(h), []);
  const onTap = useCallback(() => setChrome((c) => !c), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanel(null);
        setEditing(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (book.data) document.title = `${book.data.title} · Estante`;
    return () => {
      document.title = 'Estante';
      qc.invalidateQueries({ queryKey: ['books'] });
    };
  }, [book.data, qc]);

  const bms = bookmarks.data ?? [];
  const hls = highlights.data ?? [];
  const currentBookmarks = loc ? bms.filter((b) => loc.contains(b.location)) : [];
  const isPdf = book.data?.format === 'PDF';

  function toggleBookmark() {
    if (!loc) return;
    if (currentBookmarks.length) currentBookmarks.forEach((b) => delBookmark.mutate(b.id));
    else {
      const pct = `${Math.round(loc.percent * 100)}%`;
      addBookmark.mutate({ location: loc.location, label: isPdf ? loc.label : [loc.label, pct].filter(Boolean).join(' · ') });
    }
  }

  function go(location: string) {
    readerRef.current?.goTo(location);
    setPanel(null);
  }

  function highlightSelection(color: HighlightColor, thenEdit = false) {
    if (!selection) return;
    const s = selection;
    addHighlight.mutate(
      { location: s.location, text: s.text.slice(0, 5000), color },
      { onSuccess: (h) => thenEdit && setEditing(h) },
    );
    s.clear();
    setSelection(null);
  }

  if (book.isError) {
    return (
      <div className="reader-error">
        <p>Livro não encontrado.</p>
        <Link to="/" className="btn">
          Voltar à estante
        </Link>
      </div>
    );
  }

  const ReaderComp = isPdf ? PdfReader : EpubReader;
  const percent = Math.round((loc?.percent ?? 0) * 100);

  return (
    <div className={`reader ${chrome ? 'chrome-on' : 'chrome-off'}`}>
      <header className="reader-bar reader-top">
        <Link to="/" className="icon-btn" aria-label="Voltar à estante" title="Estante">
          ←
        </Link>
        <div className="reader-title">
          <strong>{book.data?.title ?? ''}</strong>
          {loc?.label && <span className="muted small">{loc.label}</span>}
        </div>
        <button className="icon-btn" onClick={() => setPanel('toc')} aria-label="Sumário e anotações" title="Sumário">
          ☰
        </button>
        <button
          className={`icon-btn ${currentBookmarks.length ? 'active' : ''}`}
          onClick={toggleBookmark}
          aria-pressed={currentBookmarks.length > 0}
          aria-label={currentBookmarks.length ? 'Remover marcador' : 'Marcar esta página'}
          title="Marcador"
        >
          {currentBookmarks.length ? '🔖' : '🏷'}
        </button>
        <button className="icon-btn" onClick={() => setPanel('settings')} aria-label="Aparência" title="Aparência">
          Aa
        </button>
      </header>

      <main className="reader-stage">
        {book.data && sync.initial !== undefined && (
          <Suspense fallback={<div className="reader-loading">Abrindo livro…</div>}>
          <ReaderComp
            ref={readerRef}
            bookId={id}
            initialLocation={lastLocation.current ?? sync.initial?.location ?? null}
            prefs={prefs}
            highlights={hls}
            chromeVisible={chrome}
            onReady={setToc}
            onError={setError}
            onLocation={onLocation}
            onSelection={onSelection}
            onHighlightClick={onHighlightClick}
            onTap={onTap}
          />
          </Suspense>
        )}
        {error && <div className="reader-loading error">{error}</div>}
      </main>

      <footer className="reader-bar reader-bottom">
        <button className="icon-btn nav-btn" onClick={() => readerRef.current?.prev()} aria-label="Página anterior">
          ‹
        </button>
        <div className="reader-progress">
          <div className="bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="muted small">{isPdf ? loc?.label : `${percent}%`}</span>
        </div>
        <button className="icon-btn nav-btn" onClick={() => readerRef.current?.next()} aria-label="Próxima página">
          ›
        </button>
      </footer>

      {sync.remote && (
        <div className="toast" role="status">
          <span>
            Você leu até {Math.round(sync.remote.percent * 100)}%
            {sync.remote.device ? ` no ${sync.remote.device}` : ' em outro aparelho'}.
          </span>
          <div className="toast-actions">
            <button
              className="btn btn-primary small"
              onClick={() => {
                readerRef.current?.goTo(sync.remote!.location);
                sync.dismissRemote();
              }}
            >
              Ir para lá
            </button>
            <button className="btn btn-ghost small" onClick={sync.dismissRemote}>
              Ficar aqui
            </button>
          </div>
        </div>
      )}

      {selection && !editing && (
        <Popover anchor={selection.rect}>
          <div className="hl-picker">
            {COLORS.map((c) => (
              <button
                key={c}
                className="swatch"
                style={{ background: HIGHLIGHT_FILL[c] }}
                aria-label={`Destacar em ${COLOR_NAMES[c]}`}
                onClick={() => highlightSelection(c)}
              />
            ))}
            <span className="divider" />
            <button className="btn btn-ghost small" onClick={() => highlightSelection('yellow', true)}>
              Nota
            </button>
          </div>
        </Popover>
      )}

      {editing && (
        <HighlightSheet
          key={editing.id}
          highlight={editing}
          onClose={() => setEditing(null)}
          onColor={(color) => {
            patchHighlight.mutate({ id: editing.id, color });
            setEditing({ ...editing, color });
          }}
          onSaveNote={(note) => {
            patchHighlight.mutate({ id: editing.id, note: note || null });
            setEditing(null);
          }}
          onDelete={() => {
            delHighlight.mutate(editing.id);
            setEditing(null);
          }}
        />
      )}

      {panel === 'settings' && (
        <>
          <div className="scrim" onClick={() => setPanel(null)} />
          <div className="sheet sheet-bottom" role="dialog" aria-label="Aparência">
            <div className="sheet-head">
              <strong>Aparência</strong>
              <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Fechar">
                ✕
              </button>
            </div>
            <SettingsPanel textControls={!isPdf} />
          </div>
        </>
      )}

      {panel && panel !== 'settings' && (
        <SidePanel
          initialTab={panel}
          toc={toc}
          bookmarks={bms}
          highlights={hls}
          isPdf={isPdf}
          onGo={go}
          onDeleteBookmark={(bmId) => delBookmark.mutate(bmId)}
          onEditHighlight={(h) => {
            setPanel(null);
            setEditing(h);
          }}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

function HighlightSheet(props: {
  highlight: Highlight;
  onClose: () => void;
  onColor: (c: HighlightColor) => void;
  onSaveNote: (note: string) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(props.highlight.note ?? '');
  return (
    <>
      <div className="scrim" onClick={props.onClose} />
      <div className="sheet sheet-bottom" role="dialog" aria-label="Destaque">
        <div className="sheet-head">
          <strong>Destaque</strong>
          <button className="icon-btn" onClick={props.onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <blockquote className={`hl-quote hl-border-${props.highlight.color}`}>“{props.highlight.text}”</blockquote>
        <div className="hl-picker">
          {COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              aria-pressed={props.highlight.color === c}
              style={{ background: HIGHLIGHT_FILL[c] }}
              aria-label={COLOR_NAMES[c]}
              onClick={() => props.onColor(c)}
            />
          ))}
        </div>
        <label className="form">
          <span className="field-label">Nota</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Escreva algo sobre este trecho…" />
        </label>
        <div className="sheet-actions">
          <button className="btn btn-ghost danger" onClick={props.onDelete}>
            Apagar destaque
          </button>
          <button className="btn btn-primary" onClick={() => props.onSaveNote(note)}>
            Salvar
          </button>
        </div>
      </div>
    </>
  );
}
