import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadBook, type Book } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Cover } from '../components/Cover';
import { ThemeSwitch } from '../components/SettingsPanel';

interface UploadJob {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

const ACCEPT = '.epub,.pdf,application/epub+zip,application/pdf';

export function LibraryPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books') });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/books/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['books'] }),
  });

  function patchJob(key: string, patch: Partial<UploadJob>) {
    setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...patch } : j)));
  }

  async function uploadOne(file: File) {
    const key = `${file.name}-${file.size}-${Date.now()}`;
    setJobs((js) => [...js, { key, name: file.name, progress: 0 }]);
    try {
      const form = new FormData();
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        try {
          const { extractPdfMeta } = await import('../lib/pdf');
          const meta = await extractPdfMeta(file);
          if (meta.title) form.append('title', meta.title);
          if (meta.author) form.append('author', meta.author);
          if (meta.cover) form.append('cover', meta.cover, 'cover.jpg');
        } catch {
          /* segue sem capa */
        }
      }
      form.append('file', file);
      const book = await uploadBook(form, (p) => patchJob(key, { progress: p }));
      qc.setQueryData<Book[]>(['books'], (old) => [book, ...(old ?? [])]);
      setJobs((js) => js.filter((j) => j.key !== key));
    } catch (e) {
      patchJob(key, { error: e instanceof Error ? e.message : 'Falha no envio' });
    }
  }

  function onFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) void uploadOne(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    onFiles(e.dataTransfer.files);
  }

  const list = books.data ?? [];
  const reading = list.filter((b) => b.percent > 0 && b.percent < 0.995);

  return (
    <div
      className="library"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ❦
          </span>
          Estante
        </div>
        <div className="topbar-actions">
          <ThemeSwitch />
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
            <span aria-hidden>＋</span> Adicionar livro
          </button>
          <details className="menu">
            <summary className="btn btn-ghost avatar" aria-label="Conta">
              {(user?.name || user?.email || '?')[0].toUpperCase()}
            </summary>
            <div className="menu-pop">
              <div className="muted small">{user?.email}</div>
              <button className="btn btn-ghost" onClick={logout}>
                Sair
              </button>
            </div>
          </details>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </header>

      <main className="library-main">
        {reading[0] && (
          <Link to={`/ler/${reading[0].id}`} className="continue">
            <div className="continue-cover">
              <Cover book={reading[0]} />
            </div>
            <div className="continue-body">
              <span className="eyebrow">Continuar lendo</span>
              <strong className="continue-title">{reading[0].title}</strong>
              {reading[0].author && <span className="muted">{reading[0].author}</span>}
              <div className="bar">
                <span style={{ width: `${Math.round(reading[0].percent * 100)}%` }} />
              </div>
              <span className="muted small">{Math.round(reading[0].percent * 100)}% lido</span>
            </div>
          </Link>
        )}

        <div className="section-head">
          <h2>Biblioteca</h2>
          {list.length > 0 && <span className="muted small">{list.length} livro{list.length > 1 ? 's' : ''}</span>}
        </div>

        {books.isLoading && <p className="muted">Carregando…</p>}
        {books.isError && <p className="error">Não foi possível carregar a biblioteca.</p>}

        {!books.isLoading && list.length === 0 && jobs.length === 0 && (
          <button className="empty" onClick={() => inputRef.current?.click()}>
            <span className="empty-icon" aria-hidden>
              ❦
            </span>
            <strong>Sua estante está vazia</strong>
            <span className="muted">Arraste arquivos EPUB ou PDF para cá, ou toque para escolher.</span>
          </button>
        )}

        <ul className="grid">
          {jobs.map((j) => (
            <li key={j.key} className="book uploading">
              <div className="cover">
                <div className="cover-upload">
                  {j.error ? (
                    <>
                      <span className="error small">{j.error}</span>
                      <button className="btn btn-ghost small" onClick={() => setJobs((js) => js.filter((x) => x.key !== j.key))}>
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
          {list.map((b) => (
            <li key={b.id} className="book">
              <Link to={`/ler/${b.id}`} className="cover" aria-label={`Ler ${b.title}`}>
                <Cover book={b} />
                <span className="badge">{b.format}</span>
                {b.percent > 0 && (
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
                </div>
                <button
                  className="icon-btn small"
                  aria-label={`Remover ${b.title}`}
                  title="Remover"
                  onClick={() => {
                    if (confirm(`Remover "${b.title}" da estante? Marcadores e destaques também serão apagados.`)) {
                      remove.mutate(b.id);
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>

      {dragging && (
        <div className="dropzone" aria-hidden>
          <div>Solte para adicionar à estante</div>
        </div>
      )}
    </div>
  );
}
