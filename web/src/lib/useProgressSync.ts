import { useCallback, useEffect, useRef, useState } from 'react';
import { api, deviceLabel, type Progress } from './api';

interface Pending {
  location: string;
  percent: number;
  updatedAt: string;
}

/**
 * Sincroniza a posição de leitura com o servidor:
 * - carrega a última posição ao abrir
 * - salva com debounce e ao sair/esconder a aba
 * - ao voltar para a aba, avisa se outro aparelho leu mais recentemente
 */
export function useProgressSync(bookId: string) {
  const [initial, setInitial] = useState<Progress | null | undefined>(undefined);
  const [remote, setRemote] = useState<Progress | null>(null);
  const current = useRef<string | null>(null);
  const lastLocalAt = useRef(0);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<number>(undefined);
  const device = useRef(deviceLabel());

  const url = `/books/${bookId}/progress`;

  const send = useCallback(
    async (keepalive = false) => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      const body = { ...p, device: device.current };
      if (keepalive) {
        fetch(`/api${url}`, {
          method: 'PUT',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
        return;
      }
      try {
        const res = await api<{ progress: Progress; applied: boolean }>(url, { method: 'PUT', json: body });
        if (!res.applied && res.progress.location !== current.current) setRemote(res.progress);
      } catch {
        // sem rede: tenta de novo na próxima mudança
        pending.current ??= p;
      }
    },
    [url],
  );

  const checkRemote = useCallback(async () => {
    try {
      const { progress } = await api<{ progress: Progress | null }>(url);
      if (
        progress &&
        new Date(progress.updatedAt).getTime() > lastLocalAt.current + 1000 &&
        progress.location !== current.current
      ) {
        setRemote(progress);
      }
    } catch {
      /* offline */
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    api<{ progress: Progress | null }>(url)
      .then(({ progress }) => {
        if (cancelled) return;
        if (progress) lastLocalAt.current = new Date(progress.updatedAt).getTime();
        setInitial(progress);
      })
      .catch(() => !cancelled && setInitial(null));
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(timer.current);
        void send(true);
      } else {
        void checkRemote();
      }
    };
    const onPageHide = () => void send(true);
    const interval = window.setInterval(() => document.visibilityState === 'visible' && checkRemote(), 45_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.clearInterval(interval);
      window.clearTimeout(timer.current);
      void send(true);
    };
  }, [send, checkRemote]);

  const report = useCallback(
    (location: string, percent: number) => {
      if (location === current.current) return;
      const firstReport = current.current === null;
      current.current = location;
      // A primeira posição é a restaurada do servidor: não precisa salvar de novo
      if (firstReport && initial?.location === location) return;
      const now = Date.now();
      lastLocalAt.current = now;
      pending.current = { location, percent, updatedAt: new Date(now).toISOString() };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send(), 1500);
    },
    [send, initial],
  );

  return { initial, remote, dismissRemote: () => setRemote(null), report };
}
