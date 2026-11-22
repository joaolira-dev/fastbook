import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo deu errado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden>
            ❦
          </span>
          Estante
        </div>
        <p className="auth-sub">Seus livros, no ponto onde você parou, em qualquer aparelho.</p>

        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')} type="button">
            Entrar
          </button>
          <button role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')} type="button">
            Criar conta
          </button>
        </div>

        <form onSubmit={onSubmit} className="form">
          {mode === 'register' && (
            <label>
              Nome <span className="muted">(opcional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label>
            E-mail
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              required
              minLength={mode === 'register' ? 6 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </main>
  );
}
