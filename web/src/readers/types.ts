import type { Highlight, Preferences } from '../lib/api';

export interface TocItem {
  label: string;
  location: string;
  children?: TocItem[];
}

export interface ReaderLocation {
  location: string;
  percent: number;
  /** "Capítulo 3" ou "Página 12 de 200" */
  label: string;
  /** A posição salva (de um marcador, por exemplo) está visível agora? */
  contains: (location: string) => boolean;
  /** Quanto falta, em caracteres (EPUB) ou páginas (PDF); ausente enquanto ainda é calculado */
  remaining?: { unit: 'chars' | 'pages'; book: number; chapter?: number };
}

export interface SearchHit {
  location: string;
  excerpt: string;
  /** Capítulo ou página onde o trecho está */
  label: string;
}

export interface SelectionInfo {
  location: string;
  text: string;
  /** Retângulo da seleção em coordenadas da janela */
  rect: DOMRect;
  clear: () => void;
}

export interface ReaderHandle {
  next: () => void;
  prev: () => void;
  goTo: (location: string, opts?: { flash?: boolean }) => void;
  /** Procura no livro inteiro; para cedo se o sinal for abortado */
  search: (query: string, signal: AbortSignal) => Promise<SearchHit[]>;
}

export interface ReaderProps {
  bookId: string;
  initialLocation: string | null;
  prefs: Preferences;
  highlights: Highlight[];
  chromeVisible: boolean;
  onReady: (toc: TocItem[]) => void;
  onError: (message: string) => void;
  onLocation: (loc: ReaderLocation) => void;
  onSelection: (sel: SelectionInfo | null) => void;
  onHighlightClick: (highlight: Highlight, rect: DOMRect) => void;
  /** Toque no meio da página: mostra/esconde a barra */
  onTap: () => void;
}

export const HIGHLIGHT_FILL: Record<Highlight['color'], string> = {
  yellow: '#f5d142',
  green: '#7fd17a',
  blue: '#6fb4f2',
  pink: '#f28bb8',
};

/** Decide o que fazer com um toque/clique na posição x da área de leitura. */
export function tapZone(x: number, width: number): 'prev' | 'next' | 'center' {
  if (x < width * 0.28) return 'prev';
  if (x > width * 0.72) return 'next';
  return 'center';
}

export const SEARCH_LIMIT = 300;

/** Minúsculas e sem acentos, preservando o tamanho da string (para mapear posições). */
export function foldText(s: string): string {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += (base.length === ch.length ? base : ch).toLowerCase();
  }
  return out;
}

/** Anima a troca de página (o conteúdo novo entra pelo lado de onde se está indo). */
export function animateTurn(el: HTMLElement | null, style: 'slide' | 'fade' | 'none', dir: 1 | -1) {
  if (!el || style === 'none' || !el.animate) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const from = style === 'slide' ? { opacity: 0.15, transform: `translateX(${dir * 36}px)` } : { opacity: 0.1 };
  const to = style === 'slide' ? { opacity: 1, transform: 'translateX(0)' } : { opacity: 1 };
  el.animate([from, to], { duration: style === 'slide' ? 280 : 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
}
