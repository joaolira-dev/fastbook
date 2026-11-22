import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type HighlightColor, type HighlightWithBook } from '../lib/api';
import { HIGHLIGHT_FILL } from '../readers/types';
import { Icon } from '../components/Icon';

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
const COLOR_NAMES: Record<HighlightColor, string> = { yellow: 'Amarelo', green: 'Verde', blue: 'Azul', pink: 'Rosa' };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

type Group = { book: HighlightWithBook['book']; items: HighlightWithBook[] };

function toMarkdown(groups: Group[]): string {
  const out: string[] = ['# Anotações — fastbook', ''];
  for (const g of groups) {
    out.push(`## ${g.book.title}${g.book.author ? ` — ${g.book.author}` : ''}`, '');
    for (const h of g.items) {
      out.push(`> ${h.text.replace(/\n+/g, '\n> ')}`);
      if (h.note) out.push('', `**Nota:** ${h.note}`);
      if (g.book.format === 'PDF') out.push('', `_Página ${h.location}_`);
      out.push('');
    }
  }
  return out.join('\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NotesPage() {
  const all = useQuery({ queryKey: ['highlights-all'], queryFn: () => api<HighlightWithBook[]>('/highlights') });
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<HighlightColor | null>(null);
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [bookId, setBookId] = useState<string>('');

  const items = all.data ?? [];
  const books = useMemo(() => {
    const m = new Map<string, HighlightWithBook['book']>();
    for (const h of items) m.set(h.book.id, h.book);
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  }, [items]);

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const map = new Map<string, Group>();
    for (const h of items) {
      if (color && h.color !== color) continue;
      if (onlyNotes && !h.note) continue;
      if (bookId && h.book.id !== bookId) continue;
      if (q && !fold(`${h.text} ${h.note ?? ''} ${h.book.title}`).includes(q)) continue;
      const g = map.get(h.book.id) ?? { book: h.book, items: [] };
      g.items.push(h);
      map.set(h.book.id, g);
    }
    return [...map.values()];
  }, [items, query, color, onlyNotes, bookId]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">
            {items.length} destaque{items.length === 1 ? '' : 's'} em {books.length} livro{books.length === 1 ? '' : 's'}
          </span>
          <h1>Anotações</h1>
        </div>
        {total > 0 && (
          <button className="btn" onClick={() => download('anotacoes-fastbook.md', toMarkdown(groups))}>
            <Icon name="download" size={18} /> Exportar Markdown
          </button>
        )}
      </header>

      <div className="library-tools">
        <div className="library-filters">
          <label className="search-box">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder="Buscar nos destaques e notas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar nas anotações"
            />
          </label>
          <select className="select" value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Filtrar por livro">
            <option value="">Todos os livros</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
        <div className="chip-row">
          {COLORS.map((c) => (
            <button
              key={c}
              className="chip"
              aria-pressed={color === c}
              onClick={() => setColor(color === c ? null : c)}
            >
              <span className="dot" style={{ background: HIGHLIGHT_FILL[c] }} />
              {COLOR_NAMES[c]}
            </button>
          ))}
          <button className="chip" aria-pressed={onlyNotes} onClick={() => setOnlyNotes(!onlyNotes)}>
            <Icon name="edit" size={14} /> Com nota
          </button>
        </div>
      </div>

      {all.isLoading && <p className="muted">Carregando…</p>}
      {!all.isLoading && items.length === 0 && (
        <div className="empty static">
          <Icon name="notes" size={40} className="empty-icon" />
          <strong>Nenhum destaque ainda</strong>
          <span className="muted">Selecione um trecho enquanto lê para destacar e anotar. Tudo aparece aqui.</span>
        </div>
      )}
      {items.length > 0 && total === 0 && <p className="muted pad center">Nenhum destaque com esses filtros.</p>}

      <div className="note-groups">
        {groups.map((g) => (
          <section key={g.book.id} className="note-group">
            <div className="note-group-head">
              <div>
                <h2>{g.book.title}</h2>
                {g.book.author && <span className="muted small">{g.book.author}</span>}
              </div>
              <span className="muted small">{g.items.length}</span>
            </div>
            <ul className="note-cards">
              {g.items.map((h) => (
                <li key={h.id} className="note-card">
                  <blockquote className={`hl-quote full hl-border-${h.color}`}>{h.text}</blockquote>
                  {h.note && <p className="note-text">{h.note}</p>}
                  <div className="note-foot">
                    <span className="muted small">
                      {dateFmt.format(new Date(h.createdAt))}
                      {g.book.format === 'PDF' ? ` · Página ${h.location}` : ''}
                    </span>
                    <Link className="btn btn-ghost small" to={`/ler/${g.book.id}?ir=${encodeURIComponent(h.location)}`}>
                      Abrir no livro
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
