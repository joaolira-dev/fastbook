import { useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useUploads } from '../lib/uploads';
import { usePrefs } from '../lib/prefs';
import { localDate } from '../lib/api';
import { useStats } from '../lib/stats';
import { Brand } from './Brand';
import { Icon, type IconName } from './Icon';
import { ThemeSwitch } from './SettingsPanel';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Biblioteca', icon: 'library' },
  { to: '/anotacoes', label: 'Anotações', icon: 'notes' },
  { to: '/estatisticas', label: 'Estatísticas', icon: 'stats' },
];

function GoalRing({ value, size = 36 }: { value: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="goal-ring" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="goal-ring-bg" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="goal-ring-fg"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, value))}
      />
    </svg>
  );
}

export { GoalRing };

function TodayGoal() {
  const { prefs } = usePrefs();
  const stats = useStats();
  const today = stats.data?.days.find((d) => d.date === localDate())?.seconds ?? 0;
  const minutes = Math.floor(today / 60);
  return (
    <NavLink to="/estatisticas" className="today-goal">
      <GoalRing value={today / 60 / prefs.dailyGoal} />
      <div>
        <strong>
          {minutes} de {prefs.dailyGoal} min
        </strong>
        <span className="muted small">{minutes >= prefs.dailyGoal ? 'Meta de hoje batida!' : 'Meta de hoje'}</span>
      </div>
    </NavLink>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  return (
    <details className="menu">
      <summary className="btn btn-ghost avatar" aria-label="Conta">
        {(user?.name || user?.email || '?')[0].toUpperCase()}
      </summary>
      <div className="menu-pop">
        {user?.name && <strong>{user.name}</strong>}
        <div className="muted small menu-email">{user?.email}</div>
        <button className="btn btn-ghost menu-item" onClick={logout}>
          <Icon name="logout" size={18} /> Sair
        </button>
      </div>
    </details>
  );
}

/** Moldura das telas principais: barra lateral no PC, abas embaixo no celular. */
export function AppShell({ children }: { children: ReactNode }) {
  const uploads = useUploads();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  return (
    <div
      className="shell"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        uploads.addFiles(e.dataTransfer.files);
      }}
    >
      <aside className="sidebar">
        <Brand />
        <button className="btn btn-primary sidebar-add" onClick={uploads.pick}>
          <Icon name="plus" size={18} /> Adicionar livro
        </button>
        <nav className="sidebar-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end className="nav-item">
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <TodayGoal />
          <div className="sidebar-row">
            <AccountMenu />
            <ThemeSwitch />
          </div>
        </div>
      </aside>

      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <ThemeSwitch />
          <button className="icon-btn" onClick={uploads.pick} aria-label="Adicionar livro" title="Adicionar livro">
            <Icon name="plus" />
          </button>
          <AccountMenu />
        </div>
      </header>

      <div className="shell-main">{children}</div>

      <nav className="tabbar">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end className="tab-item">
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      {dragging && (
        <div className="dropzone" aria-hidden>
          <div>Solte para adicionar ao fastbook</div>
        </div>
      )}
    </div>
  );
}
