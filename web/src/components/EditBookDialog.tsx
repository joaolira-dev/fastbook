import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, STATUS_LABEL, type Book, type ReadingStatus } from '../lib/api';
import { Cover } from './Cover';
import { Icon } from './Icon';

async function putCover(bookId: string, file: File): Promise<Book> {
  const form = new FormData();
  form.append('cover', file);
  const res = await fetch(`/api/books/${bookId}/cover`, { method: 'PUT', body: form, credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);
  return body as Book;
}

export function EditBookDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? '');
  const [status, setStatus] = useState<ReadingStatus>(book.status);
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let updated = await api<Book>(`/books/${book.id}`, {
        method: 'PATCH',
        json: { title, author: author || null, ...(status !== book.status ? { status } : {}) },
      });
      if (cover) updated = await putCover(book.id, cover);
      return updated;
    },
    onSuccess: (b) => {
      qc.setQueryData<Book[]>(['books'], (old) => old?.map((x) => (x.id === b.id ? b : x)));
      qc.invalidateQueries({ queryKey: ['stats'] });
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) save.mutate();
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="dialog" role="dialog" aria-label="Editar livro" onSubmit={onSubmit}>
        <div className="sheet-head">
          <strong>Editar livro</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        <div className="edit-grid">
          <label className="edit-cover" title="Trocar capa">
            {preview ? <img className="cover-img" src={preview} alt="" /> : <Cover book={book} />}
            <span className="edit-cover-hint">
              <Icon name="image" size={18} /> Trocar capa
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setCover(f);
                setPreview(URL.createObjectURL(f));
              }}
            />
          </label>
          <div className="form">
            <label>
              Título
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
            </label>
            <label>
              Autor
              <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={300} />
            </label>
            <div className="field">
              <span className="field-label">Prateleira</span>
              <div className="segmented">
                {(['reading', 'want', 'finished'] as ReadingStatus[]).map((s) => (
                  <button type="button" key={s} aria-selected={status === s} onClick={() => setStatus(s)}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {save.isError && <p className="error small">{(save.error as Error).message}</p>}
        <div className="sheet-actions end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={save.isPending || !title.trim()}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </>
  );
}
