import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ePub, { EpubCFI, type Book, type Contents, type Location, type NavItem, type Rendition } from 'epubjs';
import { fileUrl, type Highlight, type Preferences } from '../lib/api';
import { FONT_STACKS, THEME_COLORS } from '../lib/prefs';
import {
  animateTurn,
  foldText,
  HIGHLIGHT_FILL,
  SEARCH_LIMIT,
  tapZone,
  type ReaderHandle,
  type ReaderProps,
  type SearchHit,
  type TocItem,
} from './types';

const cfiCmp = new EpubCFI();
/** Caracteres por "location" gerada pelo epub.js (usado no tempo restante) */
const CHARS_PER_LOCATION = 1200;
/** Largura de uma coluna de texto, por preferência */
const COLUMN_PX = { narrow: 560, medium: 680, wide: 820 } as const;

function readerCss(p: Preferences) {
  const { fg, bg } = THEME_COLORS[p.theme];
  const link = p.theme === 'dark' ? '#e0a17c' : '#a04a22';
  // color-scheme igual ao da página: senão o navegador pinta o iframe de branco no tema escuro
  return `
    :root { color-scheme: ${p.theme === 'dark' ? 'dark' : 'light'}; }
    html, body { background: ${bg} !important; color: ${fg} !important; }
    body {
      font-family: ${FONT_STACKS[p.fontFamily]} !important;
      font-size: ${p.fontSize}% !important;
      line-height: ${p.lineHeight} !important;
      -webkit-text-size-adjust: 100%;
      text-rendering: optimizeLegibility;
    }
    p, li, div, span, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, em, strong, i, b, small, sup, sub, section, article {
      font-family: inherit !important; line-height: inherit !important; color: inherit !important;
      background-color: transparent !important;
    }
    p { text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
    a, a * { color: ${link} !important; }
    img, svg, video { max-width: 100% !important; height: auto; }
    ::selection { background: rgba(196, 104, 58, 0.32); }
  `;
}

function toToc(items: NavItem[]): TocItem[] {
  return items.map((i) => ({
    label: i.label.trim().replace(/\s+/g, ' '),
    location: i.href,
    children: i.subitems?.length ? toToc(i.subitems) : undefined,
  }));
}

export const EpubReader = forwardRef<ReaderHandle, ReaderProps>(function EpubReader(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const addedHighlights = useRef(new Map<string, string>()); // cfi -> cor
  const [ready, setReady] = useState(false);
  const turnDir = useRef<1 | -1 | 0>(0);
  const chaptersRef = useRef<{ label: string; index: number }[]>([]);
  const [wrapWidth, setWrapWidth] = useState(0);

  const turn = (dir: 1 | -1) => {
    const r = renditionRef.current;
    if (!r) return;
    turnDir.current = dir;
    void (dir > 0 ? r.next() : r.prev());
  };

  useImperativeHandle(ref, () => ({
    next: () => turn(1),
    prev: () => turn(-1),
    goTo: (location, opts) => {
      const r = renditionRef.current;
      if (!r) return;
      void r.display(location).then(() => {
        if (!opts?.flash) return;
        // Destaca o trecho por alguns segundos (resultado de busca)
        try {
          r.annotations.highlight(location, {}, undefined, 'fb-flash', { fill: '#e0a17c', 'fill-opacity': '0.55' });
          window.setTimeout(() => r.annotations.remove(location, 'highlight'), 2600);
        } catch {
          /* cfi sem intervalo */
        }
      });
    },
    search: async (query, signal) => {
      const book = bookRef.current;
      const q = foldText(query.trim());
      if (!book || q.length < 2) return [];
      const hits: SearchHit[] = [];
      const chapters = chaptersRef.current;
      const items = (book.spine as unknown as { spineItems: import('epubjs/types/section').default[] }).spineItems;
      for (const item of items) {
        if (signal.aborted || hits.length >= SEARCH_LIMIT) break;
        try {
          await item.load(book.load.bind(book));
          const doc = item.document;
          const label = [...chapters].reverse().find((c) => c.index <= item.index)?.label ?? '';
          const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n && hits.length < SEARCH_LIMIT; n = walker.nextNode()) {
            const text = n.textContent ?? '';
            const folded = foldText(text);
            for (let at = folded.indexOf(q); at >= 0 && hits.length < SEARCH_LIMIT; at = folded.indexOf(q, at + q.length)) {
              const range = doc.createRange();
              range.setStart(n, at);
              range.setEnd(n, at + q.length);
              const from = Math.max(0, at - 60);
              const excerpt =
                (from > 0 ? '…' : '') + text.slice(from, at + q.length + 80).replace(/\s+/g, ' ').trim() + '…';
              hits.push({ location: item.cfiFromRange(range), excerpt, label });
            }
          }
        } catch {
          /* seção ilegível: ignora */
        } finally {
          item.unload();
        }
      }
      return hits;
    },
  }));

  // Abre o livro uma vez
  useEffect(() => {
    const el = containerRef.current!;
    let destroyed = false;
    let book: Book | null = null;
    const chapters: { label: string; index: number }[] = [];
    chaptersRef.current = chapters;
    // Índice da seção (spine) de cada "location", para calcular quanto falta do capítulo
    let spineOfLocation: number[] = [];

    (async () => {
      try {
        const res = await fetch(fileUrl(props.bookId), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Não foi possível baixar o livro');
        const data = await res.arrayBuffer();
        if (destroyed) return;

        book = ePub(data);
        bookRef.current = book;
        await book.ready;
        if (destroyed) return;

        const rendition = book.renderTo(el, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: wantsDouble(propsRef.current.prefs.layout, el.parentElement!.clientWidth, propsRef.current.prefs.pageWidth)
            ? 'auto'
            : 'none',
          minSpreadWidth: 0,
          allowScriptedContent: false,
        } as Parameters<Book['renderTo']>[1]);
        renditionRef.current = rendition;

        rendition.hooks.content.register((contents: Contents) => {
          contents.addStylesheetCss(readerCss(propsRef.current.prefs), 'fastbook');
          const doc = contents.document;
          let t: number | undefined;
          doc.addEventListener('selectionchange', () => {
            window.clearTimeout(t);
            t = window.setTimeout(() => {
              const sel = doc.getSelection();
              if (!sel || sel.isCollapsed) propsRef.current.onSelection(null);
            }, 200);
          });
        });

        // Sumário, usado também para mostrar o capítulo atual
        const nav = await book.loaded.navigation;
        const toc = toToc(nav.toc);
        const flat = (items: NavItem[]) => {
          for (const i of items) {
            const idx = book!.spine.get(i.href)?.index;
            if (idx !== undefined) chapters.push({ label: i.label.trim(), index: idx });
            if (i.subitems) flat(i.subitems);
          }
        };
        flat(nav.toc);
        chapters.sort((a, b) => a.index - b.index);

        const emit = (loc: Location) => {
          if (!loc?.start) return;
          const b = bookRef.current!;
          const percent = b.locations.length() ? b.locations.percentageFromCfi(loc.start.cfi) : loc.start.percentage ?? 0;
          const chapter = [...chapters].reverse().find((c) => c.index <= loc.start.index);
          const start = loc.start.cfi;
          const end = loc.end.cfi;
          let remaining: { unit: 'chars'; book: number; chapter?: number } | undefined;
          if (spineOfLocation.length) {
            const cur = Math.max(0, b.locations.locationFromCfi(start) as unknown as number);
            const total = spineOfLocation.length;
            const nextChapter = chapters.find((c) => c.index > loc.start.index);
            let chapterEnd = total;
            if (nextChapter) {
              const idx = spineOfLocation.findIndex((sp, i) => i >= cur && sp >= nextChapter.index);
              if (idx >= 0) chapterEnd = idx;
            }
            remaining = {
              unit: 'chars',
              book: Math.max(0, total - cur) * CHARS_PER_LOCATION,
              chapter: Math.max(0, chapterEnd - cur) * CHARS_PER_LOCATION,
            };
          }
          propsRef.current.onLocation({
            remaining,
            location: start,
            percent: Math.min(1, Math.max(0, loc.atEnd ? 1 : percent)),
            label: chapter?.label ?? '',
            contains: (target) => {
              try {
                return cfiCmp.compare(start, target) <= 0 && cfiCmp.compare(target, end) <= 0;
              } catch {
                return false;
              }
            },
          });
        };

        rendition.on('relocated', (loc: Location) => {
          emit(loc);
          if (turnDir.current) {
            animateTurn(el, propsRef.current.prefs.pageTurn, turnDir.current);
            turnDir.current = 0;
          }
        });

        rendition.on('selected', (cfiRange: string, contents: Contents) => {
          const sel = contents.window.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) return;
          const r = sel.getRangeAt(0).getBoundingClientRect();
          const frame = (contents.window.frameElement as HTMLElement).getBoundingClientRect();
          propsRef.current.onSelection({
            location: cfiRange,
            text: sel.toString().trim(),
            rect: new DOMRect(r.left + frame.left, r.top + frame.top, r.width, r.height),
            clear: () => contents.window.getSelection()?.removeAllRanges(),
          });
        });

        // Toques: laterais viram a página, centro mostra/esconde a barra
        rendition.on('click', (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest?.('a')) return;
          const view = target.ownerDocument.defaultView!;
          if (!view.getSelection()?.isCollapsed) return;
          const frame = (view.frameElement as HTMLElement).getBoundingClientRect();
          const box = el.getBoundingClientRect();
          const zone = tapZone(e.clientX + frame.left - box.left, box.width);
          if (zone === 'prev') turn(-1);
          else if (zone === 'next') turn(1);
          else propsRef.current.onTap();
        });

        let touch: { x: number; y: number; t: number } | null = null;
        rendition.on('touchstart', (e: TouchEvent) => {
          const t = e.changedTouches[0];
          touch = { x: t.screenX, y: t.screenY, t: Date.now() };
        });
        rendition.on('touchend', (e: TouchEvent) => {
          if (!touch) return;
          const t = e.changedTouches[0];
          const dx = t.screenX - touch.x;
          const dy = t.screenY - touch.y;
          const quick = Date.now() - touch.t < 600;
          touch = null;
          const view = (e.target as HTMLElement).ownerDocument.defaultView;
          if (!view?.getSelection()?.isCollapsed) return;
          if (quick && Math.abs(dx) > 50 && Math.abs(dy) < 60) {
            turn(dx < 0 ? 1 : -1);
          }
        });

        // Teclas dentro do iframe: repassa para a janela (atalhos e virar página)
        rendition.on('keydown', (e: KeyboardEvent) => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }));
        });

        const initial = propsRef.current.initialLocation;
        try {
          await rendition.display(initial ?? undefined);
        } catch {
          await rendition.display();
        }
        if (destroyed) return;
        setReady(true);
        propsRef.current.onReady(toc);

        // Posições para o cálculo de % (cacheado por livro)
        const cacheKey = `fastbook:loc:${props.bookId}`;
        let cached: string | null = null;
        try {
          cached = localStorage.getItem(cacheKey);
        } catch {
          /* sem storage */
        }
        if (cached) book.locations.load(cached);
        else {
          await book.locations.generate(1200);
          try {
            localStorage.setItem(cacheKey, book.locations.save());
          } catch {
            /* cheio */
          }
        }
        const list = (book.locations as unknown as { _locations: string[] })._locations ?? [];
        spineOfLocation = list.map((cfi) => {
          try {
            return new EpubCFI(cfi).spinePos;
          } catch {
            return 0;
          }
        });
        if (!destroyed) {
          const loc = rendition.currentLocation() as unknown as Location;
          if (loc) emit(loc);
        }
      } catch (err) {
        if (!destroyed) propsRef.current.onError(err instanceof Error ? err.message : 'Erro ao abrir o EPUB');
      }
    })();

    return () => {
      destroyed = true;
      addedHighlights.current.clear();
      renditionRef.current = null;
      bookRef.current = null;
      book?.destroy();
    };
  }, [props.bookId]);

  // Teclado (inclui o repassado de dentro do iframe)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [role="dialog"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) turn(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) turn(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Largura disponível (decide 1 ou 2 páginas no modo automático)
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWrapWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const double = wantsDouble(props.prefs.layout, wrapWidth, props.prefs.pageWidth);
  const col = COLUMN_PX[props.prefs.pageWidth];
  const maxWidth = double ? col * 2 + 96 : col + 48;

  useEffect(() => {
    const r = renditionRef.current;
    if (!r || !ready) return;
    const loc = r.currentLocation() as unknown as Location | undefined;
    r.spread(double ? 'auto' : 'none', 0);
    const cfi = loc?.start?.cfi;
    const t = window.setTimeout(() => {
      (r.resize as () => void)();
      if (cfi) void r.display(cfi);
    }, 60);
    return () => window.clearTimeout(t);
  }, [double, maxWidth, ready]);

  // Preferências de leitura
  const { theme, fontSize, fontFamily, lineHeight } = props.prefs;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const css = readerCss(propsRef.current.prefs);
    const loc = rendition.currentLocation() as unknown as Location | undefined;
    for (const c of rendition.getContents() as unknown as Contents[]) c.addStylesheetCss(css, 'fastbook');
    // Reflui as páginas mantendo a posição
    const cfi = loc?.start?.cfi;
    const t = window.setTimeout(() => {
      (rendition.resize as () => void)();
      if (cfi) void rendition.display(cfi);
    }, 50);
    return () => window.clearTimeout(t);
  }, [theme, fontSize, fontFamily, lineHeight, ready]);

  // Destaques
  const { highlights } = props;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const added = addedHighlights.current;
    const wanted = new Map<string, Highlight>(highlights.map((h) => [h.location, h]));

    for (const [cfi, color] of added) {
      if (wanted.get(cfi)?.color !== color) {
        rendition.annotations.remove(cfi, 'highlight');
        added.delete(cfi);
      }
    }
    for (const h of highlights) {
      if (added.has(h.location)) continue;
      rendition.annotations.highlight(
        h.location,
        { id: h.id },
        (e: MouseEvent) => {
          const current = propsRef.current.highlights.find((x) => x.location === h.location);
          if (current) propsRef.current.onHighlightClick(current, (e.target as Element).getBoundingClientRect());
        },
        'fastbook-hl',
        { fill: HIGHLIGHT_FILL[h.color], 'fill-opacity': '0.35' },
      );
      added.set(h.location, h.color);
    }
  }, [highlights, ready]);

  return (
    <div className="epub-wrap">
      <div ref={containerRef} className="epub-area" style={{ maxWidth }} />
      {double && <div className="epub-gutter" style={{ maxWidth }} aria-hidden />}
      {!ready && <div className="reader-loading">Abrindo livro…</div>}
    </div>
  );
});

function wantsDouble(layout: ReaderProps['prefs']['layout'], width: number, pageWidth: ReaderProps['prefs']['pageWidth']) {
  if (layout === 'single') return false;
  if (layout === 'double') return width >= 700;
  // automático: duas páginas só quando cabem duas colunas confortáveis
  return width >= Math.max(1000, COLUMN_PX[pageWidth] * 2 + 140);
}
