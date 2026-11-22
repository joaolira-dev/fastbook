import type { FontFamily, Theme } from '../lib/api';
import { usePrefs } from '../lib/prefs';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Claro' },
  { id: 'sepia', label: 'Sépia' },
  { id: 'dark', label: 'Escuro' },
];

const FONTS: { id: FontFamily; label: string }[] = [
  { id: 'serif', label: 'Serifa' },
  { id: 'sans', label: 'Sem serifa' },
  { id: 'mono', label: 'Mono' },
];

export function ThemeSwitch() {
  const { prefs, update } = usePrefs();
  const order: Theme[] = ['light', 'sepia', 'dark'];
  const next = order[(order.indexOf(prefs.theme) + 1) % order.length];
  const icon = prefs.theme === 'dark' ? '☾' : prefs.theme === 'sepia' ? '◐' : '☀';
  return (
    <button
      className="icon-btn"
      onClick={() => update({ theme: next })}
      aria-label={`Tema: ${THEMES.find((t) => t.id === prefs.theme)?.label}. Trocar`}
      title="Trocar tema"
    >
      {icon}
    </button>
  );
}

export function SettingsPanel({ textControls }: { textControls: boolean }) {
  const { prefs, update } = usePrefs();
  return (
    <div className="settings">
      <div className="field">
        <span className="field-label">Tema</span>
        <div className="theme-row">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-chip theme-chip-${t.id}`}
              aria-pressed={prefs.theme === t.id}
              onClick={() => update({ theme: t.id })}
            >
              Aa
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {textControls ? (
        <>
          <div className="field">
            <span className="field-label">Tamanho do texto</span>
            <div className="stepper">
              <button
                className="icon-btn"
                aria-label="Diminuir fonte"
                onClick={() => update({ fontSize: Math.max(60, prefs.fontSize - 10) })}
              >
                <span style={{ fontSize: 13 }}>A</span>
              </button>
              <span className="stepper-val">{prefs.fontSize}%</span>
              <button
                className="icon-btn"
                aria-label="Aumentar fonte"
                onClick={() => update({ fontSize: Math.min(250, prefs.fontSize + 10) })}
              >
                <span style={{ fontSize: 20 }}>A</span>
              </button>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Fonte</span>
            <div className="segmented">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  aria-selected={prefs.fontFamily === f.id}
                  className={`font-${f.id}`}
                  onClick={() => update({ fontFamily: f.id })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Espaçamento entre linhas</span>
            <div className="stepper">
              <button
                className="icon-btn"
                aria-label="Menos espaço"
                onClick={() => update({ lineHeight: Math.max(1.2, +(prefs.lineHeight - 0.2).toFixed(1)) })}
              >
                ☰
              </button>
              <span className="stepper-val">{prefs.lineHeight.toFixed(1)}</span>
              <button
                className="icon-btn"
                aria-label="Mais espaço"
                onClick={() => update({ lineHeight: Math.min(2.4, +(prefs.lineHeight + 0.2).toFixed(1)) })}
              >
                ≡
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="muted small">Em PDFs o layout é fixo: use o zoom no canto da tela para ajustar o tamanho.</p>
      )}
    </div>
  );
}
