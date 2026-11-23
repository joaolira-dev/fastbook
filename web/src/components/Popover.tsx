import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Caixa flutuante posicionada acima (ou abaixo) de um retângulo, sem sair da tela. */
export function Popover({ anchor, onPress, children }: { anchor: DOMRect; onPress?: () => void; children: ReactNode }) {
  // No celular o menu do próprio sistema (Copiar, Pesquisar…) aparece junto da seleção e cobriria
  // o nosso: lá ele fica fixo embaixo
  const [docked] = useState(() => !!window.matchMedia?.('(pointer: coarse)').matches);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || docked) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 10;
    let left = anchor.left + anchor.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = anchor.top - height - margin;
    if (top < 60) top = anchor.bottom + margin;
    top = Math.min(top, window.innerHeight - height - margin);
    setPos({ left, top });
  }, [anchor, docked]);

  return (
    <div
      ref={ref}
      className={`popover ${docked ? 'popover-dock' : ''}`}
      onPointerDown={onPress}
      style={docked ? undefined : pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      onMouseDown={(e) => e.preventDefault() /* não perde a seleção */}
    >
      {children}
    </div>
  );
}
