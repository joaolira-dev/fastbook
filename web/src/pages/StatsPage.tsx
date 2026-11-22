import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { localDate } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { addDays, bestStreak, formatDuration, streak, useStats } from '../lib/stats';
import { GoalRing } from '../components/AppShell';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';

const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short' });

/** Barras de minutos por dia, com a linha da meta. */
function DailyBars({ byDate, goal, days }: { byDate: Map<string, number>; goal: number; days: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = Array.from({ length: days }, (_, i) => {
    const d = addDays(new Date(), i - days + 1);
    return { d, min: (byDate.get(localDate(d)) ?? 0) / 60 };
  });
  const max = Math.max(goal * 1.25, ...data.map((x) => x.min), 1);
  const avg = data.reduce((s, x) => s + x.min, 0) / days;
  return (
    <div className="chart">
      <div className="chart-plot" onMouseLeave={() => setHover(null)}>
        <div className="chart-goal" style={{ bottom: `${(goal / max) * 100}%` }}>
          <span>meta {goal} min</span>
        </div>
        {data.map((x, i) => (
          <div
            key={i}
            className={`chart-col ${hover === i ? 'hover' : ''}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            tabIndex={0}
            aria-label={`${dayMonth.format(x.d)}: ${Math.round(x.min)} minutos`}
          >
            <div
              className={`chart-bar ${x.min >= goal ? 'met' : ''}`}
              style={{ height: `${Math.max(x.min > 0 ? 2 : 0, (x.min / max) * 100)}%` }}
            />
            {hover === i && (
              <div className="chart-tip" role="tooltip">
                <strong>{Math.round(x.min)} min</strong>
                <span>{dayMonth.format(x.d)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="chart-axis">
        {data.map((x, i) => (
          <span key={i}>{days <= 14 ? weekday.format(x.d).replace('.', '') : i % 5 === 0 ? x.d.getDate() : ''}</span>
        ))}
      </div>
      <p className="muted small">Média de {Math.round(avg)} min por dia neste período.</p>
    </div>
  );
}

/** Calendário do ano no estilo "heatmap": quanto mais escuro, mais minutos. */
function YearHeatmap({ byDate, goal }: { byDate: Map<string, number>; goal: number }) {
  const weeks = 53;
  const end = new Date();
  const start = addDays(end, -(weeks * 7 - 1) - end.getDay());
  const cols: { d: Date; min: number }[][] = [];
  for (let w = 0; w < weeks + 1; w++) {
    const col = [];
    for (let k = 0; k < 7; k++) {
      const d = addDays(start, w * 7 + k);
      if (d > end) break;
      col.push({ d, min: (byDate.get(localDate(d)) ?? 0) / 60 });
    }
    if (col.length) cols.push(col);
  }
  const level = (m: number) => (m <= 0 ? 0 : m < goal * 0.5 ? 1 : m < goal ? 2 : m < goal * 2 ? 3 : 4);
  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        {cols.map((col, i) => (
          <div key={i} className="heat-col">
            {col[0].d.getDate() <= 7 && <span className="heat-month">{monthFmt.format(col[0].d).replace('.', '')}</span>}
            {col.map((c) => (
              <span
                key={c.d.toISOString()}
                className={`heat-cell l${level(c.min)}`}
                title={`${dayMonth.format(c.d)}: ${Math.round(c.min)} min`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heat-legend muted small">
        Menos {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`heat-cell l${l}`} />)} Mais
      </div>
    </div>
  );
}

export function StatsPage() {
  const stats = useStats();
  const { prefs, update } = usePrefs();
  const [range, setRange] = useState<7 | 30>(7);

  const byDate = useMemo(() => new Map(stats.data?.days.map((d) => [d.date, d.seconds]) ?? []), [stats.data]);
  const year = new Date().getFullYear();
  const today = byDate.get(localDate()) ?? 0;
  const current = streak(byDate);
  const best = bestStreak(byDate);
  const yearSeconds = [...byDate].filter(([d]) => d.startsWith(String(year))).reduce((s, [, v]) => s + v, 0);
  const finished = (stats.data?.books ?? [])
    .filter((b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === year)
    .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime());
  const topBooks = [...(stats.data?.books ?? [])].filter((b) => b.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 5);
  const goal = prefs.dailyGoal;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Seu ritmo</span>
          <h1>Estatísticas</h1>
        </div>
      </header>

      {stats.isLoading && <p className="muted">Carregando…</p>}

      <section className="kpis">
        <div className="kpi kpi-goal">
          <GoalRing value={today / 60 / goal} size={64} />
          <div>
            <span className="kpi-label">Hoje</span>
            <strong className="kpi-value">
              {Math.floor(today / 60)}
              <small> / {goal} min</small>
            </strong>
            <div className="goal-edit">
              <button className="icon-btn small" aria-label="Diminuir meta" onClick={() => update({ dailyGoal: Math.max(5, goal - 5) })}>
                −
              </button>
              <span className="muted small">meta diária</span>
              <button className="icon-btn small" aria-label="Aumentar meta" onClick={() => update({ dailyGoal: Math.min(240, goal + 5) })}>
                +
              </button>
            </div>
          </div>
        </div>
        <div className="kpi">
          <span className="kpi-label">
            <Icon name="flame" size={16} /> Sequência
          </span>
          <strong className="kpi-value">
            {current}
            <small> dia{current === 1 ? '' : 's'}</small>
          </strong>
          <span className="muted small">Recorde: {best} dia{best === 1 ? '' : 's'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">
            <Icon name="clock" size={16} /> Tempo em {year}
          </span>
          <strong className="kpi-value">{formatDuration(yearSeconds)}</strong>
          <span className="muted small">{byDate.size} dia{byDate.size === 1 ? '' : 's'} com leitura</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">
            <Icon name="check" size={16} /> Lidos em {year}
          </span>
          <strong className="kpi-value">
            {finished.length}
            <small> livro{finished.length === 1 ? '' : 's'}</small>
          </strong>
          <span className="muted small">Marque um livro como lido no menu ⋯</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Minutos por dia</h2>
          <div className="segmented compact">
            <button aria-selected={range === 7} onClick={() => setRange(7)}>
              7 dias
            </button>
            <button aria-selected={range === 30} onClick={() => setRange(30)}>
              30 dias
            </button>
          </div>
        </div>
        <DailyBars byDate={byDate} goal={goal} days={range} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Último ano</h2>
        </div>
        <YearHeatmap byDate={byDate} goal={goal} />
      </section>

      <div className="panel-row">
        <section className="panel">
          <div className="panel-head">
            <h2>Mais tempo de leitura</h2>
          </div>
          {topBooks.length === 0 ? (
            <p className="muted small">O tempo é contado enquanto você lê com a tela ativa.</p>
          ) : (
            <ol className="rank">
              {topBooks.map((b) => (
                <li key={b.id}>
                  <Link to={`/ler/${b.id}`} className="rank-item">
                    <div className="rank-cover">
                      <Cover book={b} />
                    </div>
                    <div className="rank-body">
                      <strong>{b.title}</strong>
                      <div className="bar">
                        <span style={{ width: `${(b.seconds / topBooks[0].seconds) * 100}%` }} />
                      </div>
                    </div>
                    <span className="muted small nowrap">{formatDuration(b.seconds)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Terminados em {year}</h2>
          </div>
          {finished.length === 0 ? (
            <p className="muted small">Nenhum ainda. Ao chegar na última página, o livro vai para “Lidos”.</p>
          ) : (
            <ul className="finished-grid">
              {finished.map((b) => (
                <li key={b.id} title={`${b.title} · ${dayMonth.format(new Date(b.finishedAt!))}`}>
                  <Link to={`/ler/${b.id}`} className="cover">
                    <Cover book={b} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
