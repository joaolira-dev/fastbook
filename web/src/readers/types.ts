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
  goTo: (location: string) => void;
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
