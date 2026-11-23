import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, deviceLabel, type Book, type Progress } from './api';

interface Position {
  location: string;
  /** null enquanto o livro ainda calcula o total: o servidor mantém o percentual anterior */
  percent: number | null;
  /** Relógio deste aparelho */
  at: number;
}

interface Backup extends Position {
  /** Ainda não confirmado pelo servidor */
  dirty: boolean;
}

const SAVE_DELAY = 800;
const LOAD_RETRIES = [1000, 2500, 5000, 10_000];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readBackup(key: string): Backup | null {
  try {
    const b = JSON.parse(localStorage.getItem(key) ?? 'null');
    return b && typeof b.location === 'string' && typeof b.at === 'number' ? b : null;
  } catch {
    return null;
  }
}

function writeBackup(key: string, b: Backup) {
  try {
    localStorage.setItem(key, JSON.stringify(b));
  } catch {
    /* sem storage */
  }
}

/**
 * Sincroniza a posição de leitura com o servidor:
 * - grava primeiro neste aparelho, depois no servidor (com novas tentativas se a rede falhar)
 * - salva ao sair ou esconder a aba
 * - nunca começa do início só porque a rede falhou ao abrir
 * - ao voltar para a aba, avisa se outro aparelho leu mais recentemente
 */
export function useProgressSync(bookId: string) {
  const qc = useQueryClient();
  const [initial, setInitial] = useState<Progress | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [remote, setRemote] = useState<Progress | null>(null);
  const current = useRef<string | null>(null);
  const pending = useRef<Position | null>(null);
  const sending = useRef(false);
  const timer = useRef<number>(undefined);
  const retries = useRef(0);
  /** Horário do servidor menos o deste aparelho: relógio errado não pode descartar um save */
  const clockOffset = useRef(0);
  /** Última gravação no servidor que este aparelho conhece */
  const serverAt = useRef(0);
  const device = useRef(deviceLabel());

  const url = `/books/${bookId}/progress`;
  const key = `fastbook:pos:${bookId}`;

  const put = useCallback(
    (p: Position) =>
      api<{ progress: Progress; applied: boolean }>(url, {
        method: 'PUT',
        keepalive: true, // termina mesmo se a página for fechada
        json: {
          location: p.location,
          percent: p.percent ?? undefined,
          updatedAt: new Date(p.at + clockOffset.current).toISOString(),
          device: device.current,
        },
      }),
    [url],
  );

  const confirmSaved = useCallback(
    (p: Position, progress: Progress) => {
      serverAt.current = Math.max(serverAt.current, new Date(progress.updatedAt).getTime());
      const b = readBackup(key);
      if (b && b.at <= p.at) writeBackup(key, { ...p, dirty: false });
      qc.setQueryData<Book[]>(['books'], (old) =>
        old?.map((x) => (x.id === bookId ? { ...x, percent: progress.percent, lastReadAt: progress.updatedAt } : x)),
      );
    },
    [bookId, key, qc],
  );

  const flush = useCallback(
    async (leaving = false) => {
      window.clearTimeout(timer.current);
      const p = pending.current;
      // Um envio por vez (para não chegarem fora de ordem), menos ao sair da página
      if (!p || (sending.current && !leaving)) return;
      pending.current = null;
      sending.current = true;
      try {
        const res = await put(p);
        retries.current = 0;
        if (res.applied) confirmSaved(p, res.progress);
        else {
          writeBackup(key, { ...p, dirty: false });
          serverAt.current = new Date(res.progress.updatedAt).getTime();
          if (res.progress.location !== current.current) setRemote(res.progress);
        }
      } catch (e) {
        // 4xx não adianta repetir; rede/servidor fora: tenta de novo com a posição mais nova
        if (!(e instanceof ApiError && e.status >= 400 && e.status < 500)) {
          pending.current ??= p;
          const delay = Math.min(30_000, 2000 * 2 ** retries.current++);
          timer.current = window.setTimeout(() => void flush(), delay);
        }
      } finally {
        sending.current = false;
        if (pending.current && retries.current === 0) timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
      }
    },
    [confirmSaved, key, put],
  );

  // Carrega a última posição
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const backup = readBackup(key);
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await api<{ progress: Progress | null; now?: string }>(url);
          if (cancelled) return;
          if (res.now) clockOffset.current = new Date(res.now).getTime() - Date.now();
          let progress = res.progress;
          if (backup?.dirty) {
            // Sobrou uma posição que não chegou ao servidor: o mais recente vence
            try {
              const saved = await put(backup);
              progress = saved.progress;
              confirmSaved(backup, saved.progress);
              writeBackup(key, { ...backup, dirty: false });
            } catch {
              progress = { location: backup.location, percent: backup.percent ?? 0, device: null, updatedAt: new Date(backup.at).toISOString() };
              pending.current = backup;
            }
          }
          if (cancelled) return;
          if (progress) serverAt.current = new Date(progress.updatedAt).getTime();
          setInitial(progress);
          return;
        } catch (e) {
          if (cancelled) return;
          const fatal = e instanceof ApiError && e.status >= 400 && e.status < 500;
          if (!fatal && attempt < LOAD_RETRIES.length) {
            await wait(LOAD_RETRIES[attempt]);
            if (cancelled) return;
            continue;
          }
          // Sem rede: usa a posição guardada aqui, nunca o início do livro
          if (backup) setInitial({ location: backup.location, percent: backup.percent ?? 0, device: null, updatedAt: new Date(backup.at).toISOString() });
          else setFailed(true);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, key, put, confirmSaved]);

  const checkRemote = useCallback(async () => {
    if (pending.current || sending.current) return;
    try {
      const { progress } = await api<{ progress: Progress | null }>(url);
      if (!progress || pending.current) return;
      const at = new Date(progress.updatedAt).getTime();
      if (at > serverAt.current) {
        serverAt.current = at;
        if (current.current && progress.location !== current.current) setRemote(progress);
      }
    } catch {
      /* offline */
    }
  }, [url]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush(true);
      else if (pending.current) void flush();
      else void checkRemote();
    };
    const onPageHide = () => void flush(true);
    const onOnline = () => void flush();
    const interval = window.setInterval(() => document.visibilityState === 'visible' && checkRemote(), 45_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      window.clearInterval(interval);
      // Só recarrega a biblioteca depois que a posição chegou ao servidor
      void flush(true).finally(() => {
        window.clearTimeout(timer.current);
        void qc.invalidateQueries({ queryKey: ['books'] });
      });
    };
  }, [flush, checkRemote, qc]);

  /** `moved`: o leitor mudou de página (e não apenas reabriu ou redesenhou a mesma posição) */
  const report = useCallback(
    (location: string, percent: number | null, moved: boolean) => {
      const same = location === current.current;
      current.current = location;
      const queued = pending.current?.location === location ? pending.current : null;
      if (same || !moved) {
        // Mesma posição já salva, agora com o percentual conhecido: completa o que falta
        const backup = readBackup(key);
        const stored =
          queued ?? (backup?.location === location ? backup : null) ?? (initial?.location === location ? initial : null);
        if (!stored || percent === null) return;
        if (stored.percent !== null && Math.abs(stored.percent - percent) < 0.002) return;
      }

      const p: Position = { location, percent, at: queued?.at ?? Date.now() };
      pending.current = p;
      writeBackup(key, { ...p, dirty: true });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush, initial, key],
  );

  return { initial, failed, remote, dismissRemote: () => setRemote(null), report };
}
