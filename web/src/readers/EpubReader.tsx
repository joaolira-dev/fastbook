import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ePub, { EpubCFI, type Book, type Contents, type Location, type NavItem, type Rendition } from 'epubjs';
import { fileUrl, type Highlight, type Preferences } from '../lib/api';
import { FONT_STACKS, THEME_COLORS } from '../lib/prefs';
import {
  animateTurn,
  dragCommits,
  foldText,
  HIGHLIGHT_FILL,
  reducedMotion,
  SEARCH_LIMIT,
  tapZone,
  type ReaderHandle,
  type ReaderProps,
  type SearchHit,
  type TocItem,
} from './types';

const cfiCmp = new EpubCFI();
/** Caracteres por "location" do epub.js: é a nossa página (cerca de uma tela de celular) */
const CHARS_PER_LOCATION = 700;
/** Largura de uma coluna de texto, por preferência */
const COLUMN_PX = { narrow: 560, medium: 680, wide: 820 } as const;

function readerCss(p: Preferences) {
  const { fg, bg } = THEME_COLORS[p.theme];
  const link = p.theme === 'dark' ? '#e0a17c' : '#a04a22';
  // color-scheme igual ao da página: senão o navegador pinta o iframe de branco no tema escuro
  return `
    :root { color-scheme: ${p.theme === 'dark' ? 'dark' : 'light'}; }
    html, body { background: ${bg} !important; color: ${fg} !important; }
    /* Os gestos são nossos (arrastar vira a página); selecionar texto é sempre permitido */
    html, body { touch-action: pinch-zoom; overscroll-behavior: none; }
    body, body * { -webkit-user-select: text !important; user-select: text !important; }
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

/**
 * O iframe do livro precisa de "allow-scripts": sem isso o Safari (iPhone/iPad) não entrega
 * nem os toques nem a seleção para o leitor. Os scripts do próprio livro continuam proibidos
 * por esta CSP e são removidos do documento.
 */
function hardenSection(doc: Document) {
  doc.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove());
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  const root = doc.documentElement;
  let head = doc.querySelector('head');
  if (!head) {
    head = doc.createElementNS(root.namespaceURI, 'head') as HTMLHeadElement;
    root.insertBefore(head, root.firstChild);
  }
  const meta = doc.createElementNS(root.namespaceURI, 'meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', "script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'");
  head.insertBefore(meta, head.firstChild);
}

/** Partes do gerenciador do epub.js que usamos e que não estão nos tipos públicos */
interface Manager {
  container: HTMLElement;
  layout: { delta: number };
  settings: { direction?: string };
}
const managerOf = (r: Rendition) => (r as unknown as { manager?: Manager }).manager;
const contentsOf = (r: Rendition) => r.getContents() as unknown as Contents[];

const isCfi = (s: string) => s.startsWith('epubcfi(');

/** Intervalo (destaque, busca) -> ponto inicial */
function cfiStart(cfi: string): string {
  try {
    const c = new EpubCFI(cfi);
    (c as unknown as { collapse: (toStart: boolean) => void }).collapse(true);
    return c.toString();
  } catch {
    return cfi;
  }
}

/** Retângulo do primeiro caractere visível a partir do início do intervalo. */
function startRect(range: Range): DOMRect | null {
  const doc = range.startContainer.ownerDocument!;
  let node: Node | null = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) {
    const el: Node = node.childNodes[offset] ?? node;
    const rect = (el as Element).getClientRects?.()[0];
    if (rect && el !== node && !(el as Element).textContent?.trim()) return rect; // imagem, por exemplo
    const inner = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    node = el.nodeType === Node.TEXT_NODE ? el : inner.nextNode();
    offset = 0;
    if (!node) return rect ?? null;
  }
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  for (let n: Node | null = node; n; n = walker.nextNode(), offset = 0) {
    const text = n.textContent ?? '';
    for (let i = offset; i < text.length; i++) {
      if (/\s/.test(text[i])) continue;
      const r = doc.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      const rect = r.getClientRects()[0];
      if (rect) return rect;
    }
  }
  return null;
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
  const addedHighlights = useRef(new Map<string, string>()); // cfi -> aparência
  const [ready, setReady] = useState(false);
  const turnDir = useRef<1 | -1 | 0>(0);
  /**
   * `anchor` é onde o leitor está. Só muda quando ele vira a página ou pula para outro lugar:
   * reabrir, girar a tela, mudar a letra ou carregar uma imagem redesenham em volta dela.
   */
  const pos = useRef({
    anchor: null as string | null,
    moving: false, // a próxima posição veio do leitor
    moved: false, // já virou alguma página desde que abriu
    restoring: 0, // redesenhos em andamento (ignora posições intermediárias)
    dragging: false,
    pageLeft: 0,
    movingTimer: 0,
  });
  const chaptersRef = useRef<{ label: string; index: number }[]>([]);
  const [wrapWidth, setWrapWidth] = useState(0);
  // Toques nas margens, fora do iframe do livro
  const marginTouch = useRef<{ x: number; y: number; t: number } | null>(null);

  /** A próxima posição informada pelo epub.js é uma mudança de página de verdade */
  const expectMove = () => {
    pos.current.moving = true;
    window.clearTimeout(pos.current.movingTimer);
  };
  const moveDone = () => {
    window.clearTimeout(pos.current.movingTimer);
    // Na última página não há nova posição: não deixa a marca ligada para um redesenho futuro
    pos.current.movingTimer = window.setTimeout(() => (pos.current.moving = false), 600);
  };

  const turn = (dir: 1 | -1) => {
    const r = renditionRef.current;
    if (!r || pos.current.restoring) return;
    for (const c of contentsOf(r)) c.window.getSelection()?.removeAllRanges();
    turnDir.current = dir;
    expectMove();
    void (dir > 0 ? r.next() : r.prev()).then(moveDone, moveDone);
  };

  /** Rola até a página exata onde está o cfi (o epub.js às vezes erra por uma ou mais páginas) */
  const align = (cfi: string) => {
    const r = renditionRef.current;
    const m = r && managerOf(r);
    if (!r || !m || !isCfi(cfi) || pos.current.dragging) return;
    try {
      const spine = new EpubCFI(cfi).spinePos;
      const c = contentsOf(r).find((x) => (x as unknown as { sectionIndex: number }).sectionIndex === spine);
      const rect = c && startRect(c.range(cfi));
      if (!rect || m.settings.direction === 'rtl') return;
      const left = Math.floor((rect.left + 1) / m.layout.delta) * m.layout.delta;
      const max = m.container.scrollWidth - m.container.offsetWidth;
      pos.current.pageLeft = Math.max(0, Math.min(left, max));
      if (Math.abs(m.container.scrollLeft - pos.current.pageLeft) > 1) m.container.scrollLeft = pos.current.pageLeft;
    } catch {
      /* cfi de outra edição do arquivo */
    }
  };

  /** Mostra o cfi sem contar como mudança de página */
  const restore = async (cfi: string | null) => {
    const r = renditionRef.current;
    if (!r) return;
    const st = pos.current;
    st.restoring++;
    try {
      if (cfi) st.anchor = cfi;
      try {
        // O epub.js pode nunca responder se a seção falhar ao carregar
        await Promise.race([r.display(cfi ?? undefined), new Promise((ok) => setTimeout(ok, 10_000))]);
      } catch {
        st.anchor = null;
        await r.display();
      }
      if (st.anchor) align(st.anchor);
    } finally {
      // Depois do quadro em que o epub.js mede a posição
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      st.restoring--;
    }
    if (renditionRef.current !== r || st.restoring) return;
    if (st.anchor) align(st.anchor);
    (r as unknown as { reportLocation: () => void }).reportLocation();
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useImperativeHandle(ref, () => ({
    next: () => turn(1),
    prev: () => turn(-1),
    goTo: (location, opts) => {
      const r = renditionRef.current;
      if (!r) return;
      pos.current.moved = true;
      let shown: Promise<void>;
      if (isCfi(location)) shown = restore(cfiStart(location));
      else {
        // Item do sumário: a posição é a da página que abrir
        expectMove();
        shown = r.display(location).then(moveDone, moveDone) as Promise<void>;
      }
      void shown.then(() => {
        if (!opts?.flash) return;
        // Destaca o trecho por alguns segundos (resultado de busca)
        try {
          r.annotations.highlight(location, {}, undefined, 'fb-flash', { fill: '#e0a17c', 'fill-opacity': '0.55', 'mix-blend-mode': 'normal' });
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
        (book.spine as unknown as { hooks: { content: { register: (fn: (doc: Document) => void) => void } } }).hooks.content.register(
          hardenSection,
        );

        const rendition = book.renderTo(el, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: wantsDouble(propsRef.current.prefs.layout, el.parentElement!.clientWidth, propsRef.current.prefs.pageWidth)
            ? 'auto'
            : 'none',
          minSpreadWidth: 0,
          allowScriptedContent: true, // ver hardenSection
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
          listenGestures(contents);
          // Fontes e imagens que chegam depois mudam a paginação: mantém a mesma posição
          const realign = () => {
            if (pos.current.anchor && !pos.current.moving && !destroyed) align(pos.current.anchor);
          };
          (contents as unknown as { on: (e: string, fn: () => void) => void }).on('expand', realign);
          (contents as unknown as { on: (e: string, fn: () => void) => void }).on('resize', () => requestAnimationFrame(realign));
          void doc.fonts?.ready.then(realign);
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
          const anchor = pos.current.anchor ?? loc.start.cfi;
          const located = b.locations.length() > 0;
          const percent = located ? b.locations.percentageFromCfi(anchor) : null;
          const chapter = [...chapters].reverse().find((c) => c.index <= loc.start.index);
          const start = loc.start.cfi;
          const end = loc.end.cfi;
          let remaining: { unit: 'chars'; book: number; chapter?: number } | undefined;
          if (spineOfLocation.length) {
            const cur = Math.max(0, b.locations.locationFromCfi(anchor) as unknown as number);
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
            location: anchor,
            moved: pos.current.moved,
            page: spineOfLocation.length
              ? {
                  current: Math.min(spineOfLocation.length, Math.max(0, b.locations.locationFromCfi(anchor) as unknown as number) + 1),
                  total: spineOfLocation.length,
                }
              : undefined,
            chapterPage: loc.start.displayed
              ? { current: loc.start.displayed.page, total: loc.start.displayed.total }
              : undefined,
            percent: percent === null ? null : Math.min(1, Math.max(0, loc.atEnd ? 1 : percent)),
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
          const st = pos.current;
          if (st.dragging || st.restoring || !loc?.start) return;
          const m = managerOf(rendition);
          if (m) st.pageLeft = m.container.scrollLeft;
          if (st.moving) {
            st.moving = false;
            st.moved = true;
            st.anchor = loc.start.cfi;
          } else st.anchor ??= loc.start.cfi;
          emit(loc);
          if (turnDir.current) {
            animateTurn(el, propsRef.current.prefs.pageTurn, turnDir.current);
            turnDir.current = 0;
          }
        });
        // Tela girou ou mudou de tamanho: volta para a mesma posição
        rendition.on('resized', () => {
          if (pos.current.anchor) void restoreRef.current(pos.current.anchor);
        });

        rendition.on('selected', (cfiRange: string, contents: Contents) => {
          const sel = contents.window.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) return;
          const range = sel.getRangeAt(0);
          // Seleção que cruza colunas: usa a linha inicial
          const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
          const frame = (contents.window.frameElement as HTMLElement).getBoundingClientRect();
          propsRef.current.onSelection({
            location: cfiRange,
            text: sel.toString().trim(),
            rect: new DOMRect(r.left + frame.left, r.top + frame.top, r.width, r.height),
            clear: () => contents.window.getSelection()?.removeAllRanges(),
          });
        });

        // Destaque sob o ponto (coordenadas do iframe)
        const highlightAt = (contents: Contents, x: number, y: number): Highlight | null => {
          const section = (contents as unknown as { sectionIndex: number }).sectionIndex;
          for (const h of [...propsRef.current.highlights].reverse()) {
            try {
              if (new EpubCFI(h.location).spinePos !== section) continue;
              for (const r of Array.from(contents.range(h.location).getClientRects())) {
                if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return h;
              }
            } catch {
              /* destaque de outra edição do arquivo */
            }
          }
          return null;
        };

        /** Toque ou clique simples (sem arrastar nem selecionar) */
        const onPress = (contents: Contents, e: { clientX: number; clientY: number; target: EventTarget | null }, touch: boolean) => {
          if ((e.target as Element | null)?.closest?.('a[href]')) return;
          const h = highlightAt(contents, e.clientX, e.clientY);
          if (h) {
            propsRef.current.onHighlightClick(h, new DOMRect());
            return;
          }
          if (!touch) {
            // No PC o clique no texto serve para selecionar: no máximo traz as barras de volta
            if (!propsRef.current.chromeVisible) propsRef.current.onTap();
            return;
          }
          const frame = (contents.window.frameElement as HTMLElement).getBoundingClientRect();
          const zone = tapZone(e.clientX + frame.left, window.innerWidth);
          if (zone === 'prev') turn(-1);
          else if (zone === 'next') turn(1);
          else propsRef.current.onTap();
        };

        const hasSelection = (doc: Document) => {
          const sel = doc.getSelection();
          return !!sel && !sel.isCollapsed;
        };

        // Arrastar para o lado: a página acompanha o dedo
        interface Drag {
          x: number;
          y: number;
          clientX: number;
          clientY: number;
          t: number;
          base: number;
          selecting: boolean;
          mode: 'wait' | 'drag' | 'off';
          last: { x: number; t: number };
          v: number;
        }
        let drag: Drag | null = null;
        let lastTouch = 0;

        const glide = (c: HTMLElement, to: number, done: () => void) => {
          const from = c.scrollLeft;
          if (propsRef.current.prefs.pageTurn === 'none' || reducedMotion() || Math.abs(to - from) < 2) {
            c.scrollLeft = to;
            done();
            return;
          }
          const t0 = performance.now();
          const step = (now: number) => {
            if (destroyed) return;
            const k = Math.min(1, (now - t0) / 200);
            c.scrollLeft = from + (to - from) * (1 - (1 - k) ** 3);
            if (k < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        };

        const dragTo = (dx: number) => {
          const m = managerOf(rendition);
          if (!m || !drag) return;
          const max = m.container.scrollWidth - m.container.offsetWidth;
          const rtl = m.settings.direction === 'rtl';
          const inside = !rtl && (dx < 0 ? drag.base + m.layout.delta <= max + 1 : drag.base > 1);
          m.container.scrollLeft = inside ? drag.base - dx : drag.base;
          // Início/fim do capítulo: não há página vizinha para mostrar, só desloca esta
          el.style.transform = inside ? '' : `translateX(${dx * 0.55}px)`;
          el.style.opacity = inside ? '' : String(1 - Math.min(0.5, Math.abs(dx) / 500));
        };

        const endDrag = (dx: number, commit: boolean) => {
          const m = managerOf(rendition);
          const st = pos.current;
          if (!m || !drag) {
            st.dragging = false;
            return;
          }
          const { base } = drag;
          const offEdge = el.style.transform !== '';
          el.style.transform = '';
          el.style.opacity = '';
          if (offEdge) {
            m.container.scrollLeft = base;
            st.dragging = false;
            const rtl = m.settings.direction === 'rtl';
            if (commit) turn(dx < 0 !== rtl ? 1 : -1);
            else if (propsRef.current.prefs.pageTurn !== 'none' && !reducedMotion()) {
              el.animate?.([{ transform: `translateX(${dx * 0.55}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
            }
            return;
          }
          const target = commit ? base - Math.sign(dx) * m.layout.delta : base;
          glide(m.container, target, () => {
            st.pageLeft = target;
            st.dragging = false;
            if (!commit) return;
            expectMove();
            (rendition as unknown as { reportLocation: () => void }).reportLocation();
            moveDone();
          });
        };

        function listenGestures(contents: Contents) {
          const doc = contents.document;
          let mouseSelected = false;

          doc.addEventListener(
            'touchstart',
            (e) => {
              lastTouch = Date.now();
              if (pos.current.dragging) return; // ainda terminando a virada anterior
              if (e.touches.length > 1) {
                if (drag?.mode === 'wait') drag.mode = 'off';
                return;
              }
              const t = e.changedTouches[0];
              drag = {
                x: t.screenX,
                y: t.screenY,
                clientX: t.clientX,
                clientY: t.clientY,
                t: Date.now(),
                base: pos.current.pageLeft,
                selecting: hasSelection(doc),
                mode: 'wait',
                last: { x: t.screenX, t: Date.now() },
                v: 0,
              };
            },
            { passive: true },
          );

          doc.addEventListener(
            'touchmove',
            (e) => {
              lastTouch = Date.now();
              if (!drag || drag.mode === 'off') return;
              const t = e.changedTouches[0];
              const dx = t.screenX - drag.x;
              const dy = t.screenY - drag.y;
              if (drag.mode === 'wait') {
                // Seleção em andamento ou movimento vertical: não é virada de página
                if (hasSelection(doc) || (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx))) {
                  drag.mode = 'off';
                  return;
                }
                if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
                drag.mode = 'drag';
                pos.current.dragging = true;
                el.getAnimations?.().forEach((a) => a.cancel());
                const m = managerOf(rendition);
                if (m) drag.base = m.container.scrollLeft;
              }
              const now = Date.now();
              if (now - drag.last.t >= 24) {
                drag.v = (t.screenX - drag.last.x) / (now - drag.last.t);
                drag.last = { x: t.screenX, t: now };
              }
              dragTo(dx);
            },
            { passive: true },
          );

          doc.addEventListener(
            'touchend',
            (e) => {
              lastTouch = Date.now();
              if (!drag || e.touches.length) return;
              const d = drag;
              const t = e.changedTouches[0];
              const dx = t.screenX - d.x;
              if (d.mode === 'drag') {
                const v = Date.now() - d.last.t > 120 ? 0 : d.v; // parou antes de soltar
                endDrag(dx, dragCommits(dx, el.clientWidth, v));
              } else if (
                d.mode === 'wait' &&
                Date.now() - d.t < 350 &&
                Math.abs(dx) < 10 &&
                Math.abs(t.screenY - d.y) < 10 &&
                !d.selecting &&
                !hasSelection(doc)
              ) {
                // Sem isso o "clique" emulado cairia no painel que acabou de abrir e o fecharia
                if (!(e.target as Element | null)?.closest?.('a[href]')) e.preventDefault();
                onPress(contents, { clientX: d.clientX, clientY: d.clientY, target: e.target }, true);
              }
              drag = null;
            },
            { passive: false },
          );

          doc.addEventListener('touchcancel', () => {
            lastTouch = Date.now();
            if (drag?.mode === 'drag') endDrag(0, false);
            drag = null;
          });

          doc.addEventListener('mousedown', () => {
            mouseSelected = hasSelection(doc);
          });
          doc.addEventListener('click', (e) => {
            if (Date.now() - lastTouch < 900) return; // clique emulado depois do toque
            if (e.detail > 1 || mouseSelected || hasSelection(doc)) return;
            onPress(contents, e, false);
          });
        }

        /** Selecionar texto perto da borda faz o navegador rolar entre as páginas: desfaz */
        function guardScroll() {
          const m = managerOf(rendition);
          if (!m) return;
          m.container.addEventListener('scroll', () => {
            const st = pos.current;
            if (st.dragging || st.restoring || st.moving) return;
            const { container } = m;
            const left = container.scrollLeft;
            if (contentsOf(rendition).some((c) => hasSelection(c.document))) {
              if (Math.abs(left - st.pageLeft) > 1) container.scrollLeft = st.pageLeft;
              return;
            }
            const snapped = Math.round(left / m.layout.delta) * m.layout.delta;
            if (Math.abs(left - snapped) > 2) container.scrollLeft = snapped;
            else st.pageLeft = left;
          });
        }

        // Teclas dentro do iframe: repassa para a janela (atalhos e virar página)
        rendition.on('keydown', (e: KeyboardEvent) => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }));
        });

        const initial = propsRef.current.initialLocation;
        await restoreRef.current(initial ? (isCfi(initial) ? cfiStart(initial) : initial) : null);
        if (destroyed) return;
        guardScroll();
        if (destroyed) return;
        setReady(true);
        propsRef.current.onReady(toc);

        // Posições para o cálculo de % (cacheado por livro)
        const cacheKey = `fastbook:loc${CHARS_PER_LOCATION}:${props.bookId}`;
        let cached: string | null = null;
        try {
          cached = localStorage.getItem(cacheKey);
        } catch {
          /* sem storage */
        }
        if (cached) book.locations.load(cached);
        else {
          await book.locations.generate(CHARS_PER_LOCATION);
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
          if (loc?.start && !pos.current.dragging && !pos.current.restoring) emit(loc);
        }
      } catch (err) {
        if (!destroyed) propsRef.current.onError(err instanceof Error ? err.message : 'Erro ao abrir o EPUB');
      }
    })();

    return () => {
      destroyed = true;
      pos.current = { anchor: null, moving: false, moved: false, restoring: 0, dragging: false, pageLeft: 0, movingTimer: 0 };
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

  const shownDouble = useRef<boolean | null>(null);
  useEffect(() => {
    const r = renditionRef.current;
    if (!r || !ready) return;
    const changed = shownDouble.current !== null && shownDouble.current !== double;
    shownDouble.current = double;
    if (changed) r.spread(double ? 'auto' : 'none', 0);
    const t = window.setTimeout(() => {
      (r.resize as () => void)();
      if (changed && pos.current.anchor) void restoreRef.current(pos.current.anchor);
    }, 60);
    return () => window.clearTimeout(t);
  }, [double, maxWidth, ready]);

  // A área de leitura mudou de tamanho sem a janela mudar
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => (renditionRef.current?.resize as (() => void) | undefined)?.call(renditionRef.current), 120);
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, [ready]);

  // Preferências de leitura
  const { theme, fontSize, fontFamily, lineHeight } = props.prefs;
  const appliedCss = useRef<string | null>(null);
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const css = readerCss(propsRef.current.prefs);
    if (appliedCss.current === css) return;
    const first = appliedCss.current === null;
    appliedCss.current = css;
    if (first) return; // já aplicado ao abrir
    for (const c of contentsOf(rendition)) c.addStylesheetCss(css, 'fastbook');
    // Reflui as páginas mantendo a posição
    const t = window.setTimeout(() => pos.current.anchor && void restoreRef.current(pos.current.anchor), 120);
    return () => window.clearTimeout(t);
  }, [theme, fontSize, fontFamily, lineHeight, ready]);

  // Destaques
  const { highlights } = props;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const added = addedHighlights.current;
    const wanted = new Map<string, Highlight>(highlights.map((h) => [h.location, h]));

    // "multiply" some no fundo escuro
    const blend = theme === 'dark' ? 'normal' : 'multiply';
    const look = (h: Highlight) => `${h.color}/${blend}`;

    for (const [cfi, shown] of added) {
      const h = wanted.get(cfi);
      if (!h || look(h) !== shown) {
        rendition.annotations.remove(cfi, 'highlight');
        added.delete(cfi);
      }
    }
    for (const h of highlights) {
      if (added.has(h.location)) continue;
      rendition.annotations.highlight(h.location, { id: h.id }, undefined, 'fastbook-hl', {
        fill: HIGHLIGHT_FILL[h.color],
        'fill-opacity': theme === 'dark' ? '0.42' : '0.5',
        'mix-blend-mode': blend,
      });
      added.set(h.location, look(h));
    }
  }, [highlights, theme, ready]);

  return (
    <div
      className="epub-wrap"
      onTouchStart={(e) => {
        const t = e.changedTouches[0];
        marginTouch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
      }}
      onTouchEnd={(e) => {
        const start = marginTouch.current;
        marginTouch.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = Math.abs(t.clientY - start.y);
        e.preventDefault();
        if (Math.abs(dx) > 40 && Math.abs(dx) > dy * 1.2) turn(dx < 0 ? 1 : -1);
        else if (Math.abs(dx) < 10 && dy < 10 && Date.now() - start.t < 350) {
          const zone = tapZone(t.clientX, window.innerWidth);
          if (zone === 'center') props.onTap();
          else turn(zone === 'next' ? 1 : -1);
        }
      }}
      onClick={() => !props.chromeVisible && props.onTap()}
    >
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
