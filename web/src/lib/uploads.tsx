import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadBook, type Book } from './api';

export interface UploadJob {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

interface UploadsState {
  jobs: UploadJob[];
  /** Abre o seletor de arquivos */
  pick: () => void;
  addFiles: (files: FileList | File[] | null) => void;
  dismiss: (key: string) => void;
}

const ACCEPT = '.epub,.pdf,application/epub+zip,application/pdf';
const UploadsContext = createContext<UploadsState | null>(null);

export function UploadsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const patchJob = (key: string, patch: Partial<UploadJob>) =>
    setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  const uploadOne = useCallback(
    async (file: File) => {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setJobs((js) => [...js, { key, name: file.name, progress: 0 }]);
      try {
        const form = new FormData();
        if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
          try {
            const { extractPdfMeta } = await import('./pdf');
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
    },
    [qc],
  );

  const addFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      for (const f of Array.from(files)) void uploadOne(f);
    },
    [uploadOne],
  );

  const value: UploadsState = {
    jobs,
    pick: () => inputRef.current?.click(),
    addFiles,
    dismiss: (key) => setJobs((js) => js.filter((j) => j.key !== key)),
  };

  return (
    <UploadsContext.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </UploadsContext.Provider>
  );
}

export function useUploads() {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error('useUploads fora do UploadsProvider');
  return ctx;
}
