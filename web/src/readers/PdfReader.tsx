import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import '../lib/pdf';
import { fileUrl, type Highlight } from '../lib/api';
import { animateTurn, dragCommits, foldText, SEARCH_LIMIT, tapZone, type ReaderHandle, type ReaderProps, type SearchHit, type TocItem } from './types';

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

type Span = { start: number; end: number; h: Highlight };

/**
 * Para cada item de texto da página, quais trechos [start, end) pertencem a algum destaque.
 * A busca ignora espaços, então funciona mesmo quando o destaque atravessa várias linhas.
 */
function mapHighlights(items: string[], hls: Highlight[]): Map<number, Span[]> {
  const result = new Map<number, Span[]>();
  if (!hls.length) return result;
  let compact = '';
  const pos: [number, number][] = []; // compact index -> [item, char]
  items.forEach((str, i) => {
    for (let c = 0; c < str.length; c++) {
      if (/\s/.test(str[c])) continue;
      compact += str[c];
      pos.push([i, c]);
    }
  });
  for (const h of hls) {
    const needle = h.text.replace(/\s+/g, '');
    if (needle.length < 2) continue;
    const at = compact.indexOf(needle);
    if (at < 0) continue;
    const byItem = new Map<number, Span>();
    for (let k = at; k < at + needle.length; k++) {
      const [i, c] = pos[k];
      const span = byItem.get(i);
      if (span) span.end = c + 1;
      else byItem.set(i, { start: c, end: c + 1, h });
    }
    for (const [i, span] of byItem) result.set(i, [...(result.get(i) ?? []), span]);
  }
  return result;
}

function renderItem(str: string, spans: Span[] | undefined): string {
  if (!spans?.length) return escapeHtml(str);
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let cur = 0;
  for (const { start, end, h } of sorted) {
    if (start < cur) continue;
    out += escapeHtml(str.slice(cur, start));
    out += `<mark class="pdf-hl hl-${h.color}" data-hl="${h.id}">${escapeHtml(str.slice(start, end))}</mark>`;
    cur = end;
  }
  return out + escapeHtml(str.slice(cur));
}

export const PdfReader = forwardRef<ReaderHandle, ReaderProps>(function PdfReader(props, ref) {
  const { bookId, initialLocation, highlights, prefs, chromeVisible } = props;
  const propsRef = useRef(props);
  propsRef.current = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(() => Math.max(1, parseInt(initialLocation ?? '1', 10) || 1));
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(1.414); // altura / largura
  const [zoom, setZoom] = useState(1);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const tocPages = useRef<number[]>([]);
  const turnDir = useRef<1 | -1 | 0>(0);
  const moved = useRef(false);

  const go = useCallback(
    (p: number) => {
      setPage((cur) => {
        const next = Math.min(Math.max(1, p), numPages || p);
        if (next !== cur) {
          wrapRef.current?.scrollTo({ top: 0 });
          turnDir.current = next > cur ? 1 : -1;
          moved.current = true;
        }
        return next;
      });
    },
    [numPages],
  );

  useImperativeHandle(ref, () => ({
    next: () => go(page + 1),
    prev: () => go(page - 1),
    goTo: (loc) => go(parseInt(loc, 10) || 1),
    search: async (query, signal) => {
      const pdf = pdfRef.current;
      const q = foldText(query.trim());
      if (!pdf || q.length < 2) return [];
      const hits: SearchHit[] = [];
      for (let p = 1; p <= pdf.numPages && hits.length < SEARCH_LIMIT; p++) {
        if (signal.aborted) break;
        try {
          const tc = await (await pdf.getPage(p)).getTextContent();
          const text = norm(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
          const folded = foldText(text);
          for (let at = folded.indexOf(q); at >= 0 && hits.length < SEARCH_LIMIT; at = folded.indexOf(q, at + q.length)) {
            const from = Math.max(0, at - 60);
            hits.push({
              location: String(p),
              excerpt: (from > 0 ? '…' : '') + text.slice(from, at + q.length + 80) + '…',
              label: `Página ${p}`,
            });
          }
        } catch {
          /* página sem texto */
        }
      }
      return hits;
    },
  }));

  // Tamanho disponível
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Informa a posição atual
  useEffect(() => {
    if (!numPages) return;
    const loc = String(page);
    const nextChapter = tocPages.current.find((p) => p > page);
    if (turnDir.current) {
      animateTurn(pageRef.current, propsRef.current.prefs.pageTurn, turnDir.current);
      turnDir.current = 0;
    }
    props.onLocation({
      location: loc,
      moved: moved.current,
      page: { current: page, total: numPages },
      remaining: { unit: 'pages', book: numPages - page + 1, chapter: nextChapter ? nextChapter - page : undefined },
      percent: numPages > 1 ? (page - 1) / (numPages - 1) : 1,
      label: `Página ${page} de ${numPages}`,
      contains: (l) => l === loc,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, numPages]);

  // Teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [role="dialog"]')) return;
      if (e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey && zoom <= 1)) go(page + 1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey && zoom <= 1)) go(page - 1);
      if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) setZoom((z) => Math.min(4, z + 0.25));
      if (e.key === '-' && !e.ctrlKey && !e.metaKey) setZoom((z) => Math.max(0.5, z - 0.25));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, page, zoom]);

  // Seleção de texto (mouse e toque)
  useEffect(() => {
    let t: number | undefined;
    const onChange = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount || !pageRef.current?.contains(sel.anchorNode)) {
          propsRef.current.onSelection(null);
          return;
        }
        const text = norm(sel.toString());
        if (!text) return;
        propsRef.current.onSelection({
          location: String(page),
          text,
          rect: sel.getRangeAt(0).getBoundingClientRect(),
          clear: () => document.getSelection()?.removeAllRanges(),
        });
      }, 250);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.clearTimeout(t);
    };
  }, [page]);

  // Encaixa a página inteira na tela; zoom > 1 permite rolar
  const fitWidth = box.w && box.h ? Math.min(box.w - 16, (box.h - 16) / aspect) : 0;
  const width = Math.max(100, Math.floor(fitWidth * zoom));

  const [pageItems, setPageItems] = useState<string[]>([]);
  const spansByItem = useMemo(
    () => mapHighlights(pageItems, highlights.filter((h) => h.location === String(page))),
    [pageItems, highlights, page],
  );
  const textRenderer = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) => renderItem(str, spansByItem.get(itemIndex)),
    [spansByItem],
  );

  async function onLoad(pdf: PDFDocumentProxy) {
    pdfRef.current = pdf;
    setNumPages(pdf.numPages);
    setPage((p) => Math.min(p, pdf.numPages));
    try {
      const first = await pdf.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      setAspect(vp.height / vp.width);
    } catch {
      /* mantém A4 */
    }

    const resolve = async (items: OutlineNode[]): Promise<TocItem[]> => {
      const out: TocItem[] = [];
      for (const it of items) {
        let pageNum: number | null = null;
        try {
          const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
          const target = dest?.[0];
          if (target && typeof target === 'object') pageNum = (await pdf.getPageIndex(target)) + 1;
          else if (typeof target === 'number') pageNum = target + 1;
        } catch {
          /* destino inválido */
        }
        const children = it.items?.length ? await resolve(it.items) : undefined;
        if (pageNum) out.push({ label: it.title, location: String(pageNum), children });
        else if (children?.length) out.push(...children);
      }
      return out;
    };
    let toc: TocItem[] = [];
    try {
      toc = await resolve((await pdf.getOutline()) ?? []);
    } catch {
      /* sem sumário */
    }
    const flat = (items: TocItem[]): number[] => items.flatMap((t) => [parseInt(t.location, 10), ...flat(t.children ?? [])]);
    tocPages.current = [...new Set(flat(toc))].sort((a, b) => a - b);
    propsRef.current.onReady(toc);
  }

  // Arrastar vira a página; toque no meio mostra/esconde as barras
  const touch = useRef<{ x: number; y: number; t: number; selecting: boolean; mode: 'wait' | 'drag' | 'off'; last: { x: number; t: number }; v: number } | null>(null);
  const lastTouch = useRef(0);
  const mouseSelected = useRef(false);
  const hasSelection = () => !document.getSelection()?.isCollapsed;

  function shift(dx: number | null) {
    const el = pageRef.current;
    if (el) el.style.transform = dx ? `translateX(${dx}px)` : '';
  }

  function highlightUnder(target: HTMLElement): boolean {
    const hlEl = target.closest('mark.pdf-hl') as HTMLElement | null;
    const h = hlEl && highlights.find((x) => x.id === hlEl.dataset.hl);
    if (!h) return false;
    props.onHighlightClick(h, hlEl.getBoundingClientRect());
    return true;
  }

  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (Date.now() - lastTouch.current < 900) return; // clique emulado depois do toque
    if (target.closest('a, button') || highlightUnder(target)) return;
    if (e.detail > 1 || mouseSelected.current || hasSelection()) return;
    // No PC o clique na página serve para selecionar: no máximo traz as barras de volta
    if (!chromeVisible) props.onTap();
  }

  function onTouchStart(e: React.TouchEvent) {
    lastTouch.current = Date.now();
    if (e.touches.length > 1 || (e.target as HTMLElement).closest('button')) {
      if (touch.current?.mode === 'drag') shift(null);
      touch.current = null;
      return;
    }
    const t = e.changedTouches[0];
    const now = Date.now();
    touch.current = { x: t.clientX, y: t.clientY, t: now, selecting: hasSelection(), mode: 'wait', last: { x: t.clientX, t: now }, v: 0 };
  }

  function onTouchMove(e: React.TouchEvent) {
    lastTouch.current = Date.now();
    const d = touch.current;
    if (!d || d.mode === 'off') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - d.x;
    const dy = t.clientY - d.y;
    if (d.mode === 'wait') {
      if (zoom > 1 || hasSelection() || (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx))) {
        d.mode = 'off';
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      d.mode = 'drag';
    }
    const now = Date.now();
    if (now - d.last.t >= 24) {
      d.v = (t.clientX - d.last.x) / (now - d.last.t);
      d.last = { x: t.clientX, t: now };
    }
    const atEnd = dx < 0 ? page >= numPages : page <= 1;
    shift(atEnd ? dx * 0.25 : dx);
  }

  function onTouchEnd(e: React.TouchEvent) {
    lastTouch.current = Date.now();
    const d = touch.current;
    touch.current = null;
    if (!d) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - d.x;
    if (d.mode === 'drag') {
      shift(null);
      const v = Date.now() - d.last.t > 120 ? 0 : d.v;
      if (dragCommits(dx, box.w, v)) go(dx < 0 ? page + 1 : page - 1);
      return;
    }
    if (d.mode === 'off' || Date.now() - d.t > 350 || Math.abs(dx) > 10 || Math.abs(t.clientY - d.y) > 10) return;
    if (d.selecting || hasSelection()) return;
    const target = e.target as HTMLElement;
    if (target.closest('a, button')) return;
    e.preventDefault(); // o "clique" emulado cairia no painel que acabou de abrir
    if (highlightUnder(target)) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const zone = tapZone(t.clientX - rect.left, rect.width);
    if (zone === 'prev') go(page - 1);
    else if (zone === 'next') go(page + 1);
    else props.onTap();
  }

  const themeClass = `pdf-theme-${prefs.theme}`;

  return (
    <div
      ref={wrapRef}
      className={`pdf-wrap ${themeClass} ${zoom > 1 ? 'zoomed' : ''}`}
      onClick={onClick}
      onMouseDown={() => (mouseSelected.current = hasSelection())}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        touch.current = null;
        shift(null);
      }}
    >
      <Document
        file={fileUrl(bookId)}
        onLoadSuccess={onLoad}
        onLoadError={(err) => props.onError(err.message || 'Erro ao abrir o PDF')}
        loading={<div className="reader-loading">Abrindo PDF…</div>}
        error={<div className="reader-loading">Não foi possível abrir o PDF.</div>}
      >
        {numPages > 0 && fitWidth > 0 && (
          <div className="pdf-page" ref={pageRef}>
            <Page
              key={page}
              pageNumber={page}
              width={width}
              renderTextLayer
              renderAnnotationLayer
              customTextRenderer={textRenderer}
              onGetTextSuccess={(tc) => setPageItems(tc.items.map((it) => ('str' in it ? it.str : '')))}
              loading={<div className="pdf-placeholder" style={{ width, height: width * aspect }} />}
            />
          </div>
        )}
      </Document>

      {numPages > 0 && (
        <div className={`zoom-ctrl ${chromeVisible ? '' : 'hidden'}`} onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" aria-label="Diminuir zoom" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            −
          </button>
          <button className="zoom-val" onClick={() => setZoom(1)} title="Ajustar à tela">
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn" aria-label="Aumentar zoom" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
            +
          </button>
        </div>
      )}
    </div>
  );
});
