import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, STATUS_LABEL, type Book, type ReadingStatus } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUploads } from '../lib/uploads';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { EditBookDialog } from '../components/EditBookDialog';

type Shelf = 'all' | ReadingStatus;
type Sort = 'recent' | 'added' | 'title' | 'author' | 'progress';

const SHELVES: { id: Shelf; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'reading', label: 'Lendo' },
  { id: 'want', label: 'Quero ler' },
  { id: 'finished', label: 'Lidos' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Lidos recentemente' },
  { id: 'added', label: 'Adicionados recentemente' },
  { id: 'title', label: 'Título (A–Z)' },
  { id: 'author', label: 'Autor (A–Z)' },
  { id: 'progress', label: 'Progresso' },
];

const LS_KEY = 'fastbook:library';

function readLocal(): { shelf: Shelf; sort: Sort } {
  try {
    return { shelf: 'all', sort: 'recent', ...JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') };
  } catch {
    return { shelf: 'all', sort: 'recent' };
  }
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function greeting(name?: string | null) {
  const h = new Date().getHours();
  const g = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return name ? `${g}, ${name.split(' ')[0]}` : g;
}

export function LibraryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uploads = useUploads();
  const [view, setView] = useState(readLocal);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Book | null>(null);

  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books') });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/books/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['books'] }),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReadingStatus }) =>
      api<Book>(`/books/${id}`, { method: 'PATCH', json: { status } }),
    onSuccess: (b) => qc.setQueryData<Book[]>(['books'], (old) => old?.map((x) => (x.id === b.id ? b : x))),
  });

  function patchView(p: Partial<typeof view>) {
    const next = { ...view, ...p };
    setView(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* sem storage */
    }
  }

  const list = books.data ?? [];
  const counts = useMemo(() => {
    const c: Record<Shelf, number> = { all: list.length, reading: 0, want: 0, finished: 0 };
    for (const b of list) c[b.status]++;
    return c;
  }, [list]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    const filtered = list.filter(
      (b) =>
        (view.shelf === 'all' || b.status === view.shelf) &&
        (!q || fold(b.title).includes(q) || fold(b.author ?? '').includes(q)),
    );
    const time = (s: string | null) => (s ? new Date(s).getTime() : 0);
    const sorters: Record<Sort, (a: Book, b: Book) => number> = {
      recent: (a, b) => time(b.lastReadAt ?? b.createdAt) - time(a.lastReadAt ?? a.createdAt),
      added: (a, b) => time(b.createdAt) - time(a.createdAt),
      title: (a, b) => collator.compare(a.title, b.title),
      author: (a, b) => collator.compare(a.author ?? '￿', b.author ?? '￿') || collator.compare(a.title, b.title),
      progress: (a, b) => b.percent - a.percent,
    };
    return [...filtered].sort(sorters[view.sort]);
  }, [list, query, view]);

  const reading = list
    .filter((b) => b.status === 'reading' && b.lastReadAt)
    .sort((a, b) => new Date(b.lastReadAt!).getTime() - new Date(a.lastReadAt!).getTime())
    .slice(0, 3);

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{greeting(user?.name)}</span>
          <h1>Biblioteca</h1>
        </div>
      </header>

      {reading.length > 0 && (
        <section className="continue-row" aria-label="Continuar lendo">
          {reading.map((b, i) => (
            <Link key={b.id} to={`/ler/${b.id}`} className={`continue ${i === 0 ? 'continue-main' : ''}`}>
              <div className="continue-cover">
                <Cover book={b} />
              </div>
              <div className="continue-body">
                {i === 0 && <span className="eyebrow">Continuar lendo</span>}
                <strong className="continue-title">{b.title}</strong>
                {b.author && <span className="muted small-ellipsis">{b.author}</span>}
                <div className="continue-progress">
                  <div className="bar">
                    <span style={{ width: `${Math.max(1, Math.round(b.percent * 100))}%` }} />
                  </div>
                  <span className="muted small">{Math.round(b.percent * 100)}%</span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}

      <div className="library-tools">
        <div className="segmented shelf-tabs" role="tablist">
          {SHELVES.map((s) => (
            <button key={s.id} role="tab" aria-selected={view.shelf === s.id} onClick={() => patchView({ shelf: s.id })}>
              {s.label}
              <span className="count">{counts[s.id]}</span>
            </button>
          ))}
        </div>
        <div className="library-filters">
          <label className="search-box">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder="Buscar título ou autor"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar na biblioteca"
            />
          </label>
          <select className="select" value={view.sort} onChange={(e) => patchView({ sort: e.target.value as Sort })} aria-label="Ordenar">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {books.isLoading && <p className="muted">Carregando…</p>}
      {books.isError && <p className="error">Não foi possível carregar a biblioteca.</p>}

      {!books.isLoading && list.length === 0 && uploads.jobs.length === 0 && (
        <button className="empty" onClick={uploads.pick}>
          <Icon name="library" size={40} className="empty-icon" />
          <strong>Sua biblioteca está vazia</strong>
          <span className="muted">Arraste arquivos EPUB ou PDF para cá, ou clique para escolher.</span>
        </button>
      )}

      {list.length > 0 && shown.length === 0 && (
        <p className="muted pad center">{query ? `Nada encontrado para “${query}”.` : 'Nenhum livro nesta prateleira ainda.'}</p>
      )}

      <ul className="grid">
        {uploads.jobs.map((j) => (
          <li key={j.key} className="book uploading">
            <div className="cover">
              <div className="cover-upload">
                {j.error ? (
                  <>
                    <span className="error small">{j.error}</span>
                    <button className="btn btn-ghost small" onClick={() => uploads.dismiss(j.key)}>
                      Fechar
                    </button>
                  </>
                ) : (
                  <>
                    <span className="small">Enviando…</span>
                    <div className="bar">
                      <span style={{ width: `${Math.round(j.progress * 100)}%` }} />
                    </div>
                  </>
                )}
              </div>
            </div>
            <span className="book-title">{j.name}</span>
          </li>
        ))}
        {shown.map((b, i) => (
          <li key={b.id} className="book" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
            <Link to={`/ler/${b.id}`} className="cover" aria-label={`Ler ${b.title}`}>
              <Cover book={b} />
              <span className="badge">{b.format}</span>
              {b.status === 'finished' && (
                <span className="badge badge-done" title="Lido">
                  <Icon name="check" size={12} />
                </span>
              )}
              {b.percent > 0 && b.status !== 'finished' && (
                <div className="cover-progress">
                  <span style={{ width: `${Math.max(2, Math.round(b.percent * 100))}%` }} />
                </div>
              )}
            </Link>
            <div className="book-meta">
              <div>
                <span className="book-title" title={b.title}>
                  {b.title}
                </span>
                {b.author && <span className="book-author">{b.author}</span>}
                <span className="book-status">
                  {b.status === 'reading' ? `${Math.round(b.percent * 100)}% lido` : STATUS_LABEL[b.status]}
                </span>
              </div>
              <details className="menu book-menu">
                <summary className="icon-btn small" aria-label={`Opções de ${b.title}`} title="Opções">
                  <Icon name="more" size={18} />
                </summary>
                <div className="menu-pop">
                  <button className="btn btn-ghost menu-item" onClick={(e) => { closeMenu(e); setEditing(b); }}>
                    <Icon name="edit" size={18} /> Editar
                  </button>
                  <span className="menu-sep" />
                  {(['reading', 'want', 'finished'] as ReadingStatus[]).map((s) => (
                    <button
                      key={s}
                      className="btn btn-ghost menu-item"
                      aria-pressed={b.status === s}
                      onClick={(e) => {
                        closeMenu(e);
                        if (b.status !== s) setStatus.mutate({ id: b.id, status: s });
                      }}
                    >
                      <span className="menu-check">{b.status === s && <Icon name="check" size={16} />}</span>
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                  <span className="menu-sep" />
                  <button
                    className="btn btn-ghost menu-item danger"
                    onClick={(e) => {
                      closeMenu(e);
                      if (confirm(`Remover "${b.title}"? Marcadores e destaques também serão apagados.`)) remove.mutate(b.id);
                    }}
                  >
                    <Icon name="trash" size={18} /> Remover
                  </button>
                </div>
              </details>
            </div>
          </li>
        ))}
      </ul>

      {editing && <EditBookDialog book={editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function closeMenu(e: React.MouseEvent) {
  (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
}
