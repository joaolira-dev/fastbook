/**
 * Velocidade de leitura pessoal, aprendida aos poucos a partir das viradas de página.
 * chars/min no EPUB, páginas/min no PDF. Fica só neste aparelho.
 */
type Unit = 'chars' | 'pages';
const KEY = 'fastbook:speed';
const DEFAULTS: Record<Unit, number> = { chars: 1100, pages: 0.6 }; // ~200 palavras/min; ~1,7 min/página

function load(): Record<Unit, number> {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let speeds = load();
let last: { unit: Unit; remaining: number; at: number } | null = null;

export function getSpeed(unit: Unit) {
  return speeds[unit];
}

/** Registra uma nova posição; avanços em ritmo plausível ajustam a velocidade. */
export function trackPosition(unit: Unit, remaining: number) {
  const now = Date.now();
  const prev = last;
  last = { unit, remaining, at: now };
  if (!prev || prev.unit !== unit) return;
  const advanced = prev.remaining - remaining;
  const minutes = (now - prev.at) / 60_000;
  if (advanced <= 0 || minutes < 3 / 60 || minutes > 10) return; // pulos, voltas e pausas longas não contam
  const sample = advanced / minutes;
  const cur = speeds[unit];
  if (sample < cur / 4 || sample > cur * 4) return; // folheando ou saltando capítulos
  speeds = { ...speeds, [unit]: cur * 0.92 + sample * 0.08 };
  try {
    localStorage.setItem(KEY, JSON.stringify(speeds));
  } catch {
    /* sem storage */
  }
}

export function resetTracking() {
  last = null;
}

export function formatMinutes(min: number): string {
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
