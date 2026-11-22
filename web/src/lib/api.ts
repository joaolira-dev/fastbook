export type Format = 'EPUB' | 'PDF';

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  format: Format;
  hasCover: boolean;
  createdAt: string;
  percent: number;
  lastReadAt: string | null;
}

export interface Progress {
  location: string;
  percent: number;
  device: string | null;
  updatedAt: string;
}

export interface Bookmark {
  id: string;
  location: string;
  label: string;
  createdAt: string;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface Highlight {
  id: string;
  location: string;
  text: string;
  color: HighlightColor;
  note: string | null;
  createdAt: string;
}

export type Theme = 'light' | 'dark' | 'sepia';
export type FontFamily = 'serif' | 'sans' | 'mono';

export interface Preferences {
  theme: Theme;
  fontSize: number;
  fontFamily: FontFamily;
  lineHeight: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* resposta sem JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const fileUrl = (bookId: string) => `/api/books/${bookId}/file`;
export const coverUrl = (bookId: string) => `/api/books/${bookId}/cover`;

/** Upload com barra de progresso (fetch ainda não expõe progresso de envio). */
export function uploadBook(form: FormData, onProgress: (fraction: number) => void): Promise<Book> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/books');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { error?: string } & Partial<Book> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* vazio */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Book);
      else reject(new ApiError(xhr.status, body.error ?? `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Falha de rede'));
    xhr.send(form);
  });
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'celular';
  return 'computador';
}
