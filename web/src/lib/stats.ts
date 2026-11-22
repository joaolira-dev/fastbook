import { useQuery } from '@tanstack/react-query';
import { api, localDate, type Stats } from './api';

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') });

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Dias seguidos com leitura, terminando hoje (ou ontem, se hoje ainda não leu). */
export function streak(byDate: Map<string, number>, minSeconds = 60): number {
  let day = new Date();
  if ((byDate.get(localDate(day)) ?? 0) < minSeconds) day = addDays(day, -1);
  let n = 0;
  while ((byDate.get(localDate(day)) ?? 0) >= minSeconds) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function bestStreak(byDate: Map<string, number>, minSeconds = 60): number {
  const dates = [...byDate].filter(([, s]) => s >= minSeconds).map(([d]) => d).sort();
  let best = 0;
  let cur = 0;
  let prev: string | null = null;
  for (const d of dates) {
    const expected = prev ? localDate(addDays(new Date(`${prev}T12:00:00`), 1)) : null;
    cur = expected === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
