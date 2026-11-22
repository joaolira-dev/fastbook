import type { FontFamily, Layout, PageTurn, PageWidth, Theme } from '../lib/api';
import { Icon } from './Icon';
import { usePrefs } from '../lib/prefs';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Claro' },
  { id: 'sepia', label: 'Sépia' },
  { id: 'dark', label: 'Escuro' },
];

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'auto', label: 'Automático' },
  { id: 'single', label: '1 página' },
  { id: 'double', label: '2 páginas' },
];

const WIDTHS: { id: PageWidth; label: string }[] = [
  { id: 'narrow', label: 'Estreita' },
  { id: 'medium', label: 'Média' },
  { id: 'wide', label: 'Larga' },
];

const TURNS: { id: PageTurn; label: string }[] = [
  { id: 'slide', label: 'Deslizar' },
  { id: 'fade', label: 'Esmaecer' },
  { id: 'none', label: 'Nenhuma' },
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
  const icon = prefs.theme === 'dark' ? 'moon' : prefs.theme === 'sepia' ? 'sepia' : 'sun';
  return (
    <button
      className="icon-btn"
      onClick={() => update({ theme: next })}
      aria-label={`Tema: ${THEMES.find((t) => t.id === prefs.theme)?.label}. Trocar`}
      title="Trocar tema"
    >
      <Icon name={icon} />
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

          <div className="field">
            <span className="field-label">Páginas na tela</span>
            <div className="segmented">
              {LAYOUTS.map((l) => (
                <button key={l.id} aria-selected={prefs.layout === l.id} onClick={() => update({ layout: l.id })}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Largura do texto</span>
            <div className="segmented">
              {WIDTHS.map((w) => (
                <button key={w.id} aria-selected={prefs.pageWidth === w.id} onClick={() => update({ pageWidth: w.id })}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="muted small">Em PDFs o layout é fixo: use o zoom no canto da tela para ajustar o tamanho.</p>
      )}

      <div className="field">
        <span className="field-label">Animação ao virar a página</span>
        <div className="segmented">
          {TURNS.map((t) => (
            <button key={t.id} aria-selected={prefs.pageTurn === t.id} onClick={() => update({ pageTurn: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
