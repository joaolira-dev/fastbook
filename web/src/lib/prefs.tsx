import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Preferences } from './api';
import { useAuth } from './auth';

const DEFAULTS: Preferences = {
  theme: 'light',
  fontSize: 100,
  fontFamily: 'serif',
  lineHeight: 1.6,
  layout: 'auto',
  pageWidth: 'medium',
  pageTurn: 'slide',
  dailyGoal: 20,
};
const LS_KEY = 'fastbook:prefs';
const OLD_LS_KEY = 'estante:prefs';

export const THEME_COLORS: Record<Preferences['theme'], { bg: string; fg: string; meta: string }> = {
  light: { bg: '#fbfaf7', fg: '#1f1d1a', meta: '#f4f1ea' },
  sepia: { bg: '#f4ecd8', fg: '#4a3b2c', meta: '#ece1c6' },
  dark: { bg: '#16150f', fg: '#e4dfd3', meta: '#16150f' },
};

export const FONT_STACKS: Record<Preferences['fontFamily'], string> = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

function readLocal(): Preferences {
  try {
    const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem(OLD_LS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* sem storage */
  }
  return DEFAULTS;
}

interface PrefsState {
  prefs: Preferences;
  update: (patch: Partial<Preferences>) => void;
}

const PrefsContext = createContext<PrefsState | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Preferences>(readLocal);
  const saveTimer = useRef<number>(undefined);
  const dirty = useRef(false);

  const remote = useQuery({
    queryKey: ['preferences'],
    queryFn: () => api<Preferences>('/preferences'),
    enabled: !!user,
  });

  useEffect(() => {
    if (remote.data && !dirty.current) setPrefs({ ...DEFAULTS, ...remote.data });
  }, [remote.data]);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[prefs.theme].meta);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch {
      /* sem storage */
    }
  }, [prefs]);

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        dirty.current = true;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          if (user) api('/preferences', { method: 'PUT', json: next }).finally(() => (dirty.current = false));
        }, 600);
        return next;
      });
    },
    [user],
  );

  return <PrefsContext.Provider value={{ prefs, update }}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs fora do PrefsProvider');
  return ctx;
}
