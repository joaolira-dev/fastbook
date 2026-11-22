import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { localDate } from './api';

const IDLE_MS = 2 * 60_000; // sem interação por 2 min: parou de ler
const TICK_MS = 5_000;
const FLUSH_MS = 60_000;

/**
 * Conta o tempo de leitura ativo (aba visível e alguma interação recente)
 * e envia ao servidor em lotes, agrupado pelo dia local.
 * Devolve `poke()`, para marcar atividade (ex.: virou a página).
 */
export function useReadingActivity(bookId: string) {
  const qc = useQueryClient();
  const lastActive = useRef(Date.now());
  const pending = useRef<Map<string, number>>(new Map());
  const poke = useCallback(() => {
    lastActive.current = Date.now();
  }, []);

  useEffect(() => {
    const url = `/api/books/${bookId}/activity`;
    const flush = (keepalive = false) => {
      const entries = [...pending.current];
      pending.current.clear();
      for (const [date, ms] of entries) {
        const seconds = Math.round(ms / 1000);
        if (seconds < 1) continue;
        fetch(url, {
          method: 'POST',
          keepalive,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, seconds: Math.min(600, seconds) }),
        }).catch(() => {
          /* offline: esse trecho se perde, sem problema */
        });
      }
    };

    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActive.current > IDLE_MS) return;
      const d = localDate();
      pending.current.set(d, (pending.current.get(d) ?? 0) + TICK_MS);
    }, TICK_MS);
    const flusher = window.setInterval(() => flush(), FLUSH_MS);

    const onAny = () => (lastActive.current = Date.now());
    const onHide = () => document.visibilityState === 'hidden' && flush(true);
    const events = ['keydown', 'pointermove', 'pointerdown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, onAny, { passive: true }));
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(flusher);
      events.forEach((e) => window.removeEventListener(e, onAny));
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      flush(true);
      window.setTimeout(() => qc.invalidateQueries({ queryKey: ['stats'] }), 500);
    };
  }, [bookId, qc]);

  return poke;
}
