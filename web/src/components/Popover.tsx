import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Caixa flutuante posicionada acima (ou abaixo) de um retângulo, sem sair da tela. */
export function Popover({ anchor, children }: { anchor: DOMRect; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 10;
    let left = anchor.left + anchor.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = anchor.top - height - margin;
    if (top < 60) top = anchor.bottom + margin;
    top = Math.min(top, window.innerHeight - height - margin);
    setPos({ left, top });
  }, [anchor]);

  return (
    <div
      ref={ref}
      className="popover"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      onMouseDown={(e) => e.preventDefault() /* não perde a seleção */}
    >
      {children}
    </div>
  );
}
