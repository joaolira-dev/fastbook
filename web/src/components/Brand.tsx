/** Marca do fastbook: livro aberto com um traço de velocidade. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="brand-mark">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path d="M8 10.5c2.6-.9 5.3-.6 8 1v12c-2.7-1.6-5.4-1.9-8-1z" fill="var(--accent-fg)" />
      <path d="M24 10.5c-2.6-.9-5.3-.6-8 1v12c2.7-1.6 5.4-1.9 8-1z" fill="var(--accent-fg)" opacity=".72" />
      <path d="M3 14h3M2 18h4" stroke="var(--accent-fg)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={`brand ${large ? 'brand-lg' : ''}`}>
      <BrandMark size={large ? 40 : 28} />
      <span className="brand-name">
        fast<b>book</b>
      </span>
    </div>
  );
}
