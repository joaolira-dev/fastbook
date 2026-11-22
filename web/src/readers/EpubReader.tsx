import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ePub, { EpubCFI, type Book, type Contents, type Location, type NavItem, type Rendition } from 'epubjs';
import { fileUrl, type Highlight, type Preferences } from '../lib/api';
import { FONT_STACKS, THEME_COLORS } from '../lib/prefs';
import { HIGHLIGHT_FILL, tapZone, type ReaderHandle, type ReaderProps, type TocItem } from './types';

const cfiCmp = new EpubCFI();

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

  useImperativeHandle(ref, () => ({
    next: () => void renditionRef.current?.next(),
    prev: () => void renditionRef.current?.prev(),
    goTo: (location) => void renditionRef.current?.display(location),
  }));

  // Abre o livro uma vez
  useEffect(() => {
    const el = containerRef.current!;
    let destroyed = false;
    let book: Book | null = null;
    const chapters: { label: string; index: number }[] = [];

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
          spread: 'auto',
          minSpreadWidth: 900,
          allowScriptedContent: false,
        } as Parameters<Book['renderTo']>[1]);
        renditionRef.current = rendition;

        rendition.hooks.content.register((contents: Contents) => {
          contents.addStylesheetCss(readerCss(propsRef.current.prefs), 'estante');
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
          propsRef.current.onLocation({
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

        rendition.on('relocated', emit);

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
          if (zone === 'prev') rendition.prev();
          else if (zone === 'next') rendition.next();
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
            if (dx < 0) rendition.next();
            else rendition.prev();
          }
        });

        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'ArrowRight' || e.key === 'PageDown') rendition.next();
          if (e.key === 'ArrowLeft' || e.key === 'PageUp') rendition.prev();
        };
        rendition.on('keyup', onKey);

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
        const cacheKey = `estante:loc:${props.bookId}`;
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

  // Teclado fora do iframe
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') renditionRef.current?.next();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') renditionRef.current?.prev();
    };
    window.addEventListener('keyup', onKey);
    return () => window.removeEventListener('keyup', onKey);
  }, []);

  // Preferências de leitura
  const { prefs } = props;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const css = readerCss(prefs);
    const loc = rendition.currentLocation() as unknown as Location | undefined;
    for (const c of rendition.getContents() as unknown as Contents[]) c.addStylesheetCss(css, 'estante');
    // Reflui as páginas mantendo a posição
    const cfi = loc?.start?.cfi;
    const t = window.setTimeout(() => {
      (rendition.resize as () => void)();
      if (cfi) void rendition.display(cfi);
    }, 50);
    return () => window.clearTimeout(t);
  }, [prefs, ready]);

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
        'estante-hl',
        { fill: HIGHLIGHT_FILL[h.color], 'fill-opacity': '0.35' },
      );
      added.set(h.location, h.color);
    }
  }, [highlights, ready]);

  return (
    <div className="epub-wrap">
      <div ref={containerRef} className="epub-area" />
      {!ready && <div className="reader-loading">Abrindo livro…</div>}
    </div>
  );
});
