import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import { PrefsProvider } from './lib/prefs';
import { LoginPage } from './pages/LoginPage';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import { NotesPage } from './pages/NotesPage';
import { StatsPage } from './pages/StatsPage';
import { AppShell } from './components/AppShell';
import { UploadsProvider } from './lib/uploads';
import { BrandMark } from './components/Brand';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="splash">
        <BrandMark size={48} />
      </div>
    );
  if (!user) return <LoginPage />;
  return <>{children}</>;
}

// Fecha menus (<details class="menu">) ao clicar fora deles
document.addEventListener('click', (e) => {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.menu[open]')) {
    if (!d.contains(e.target as Node)) d.removeAttribute('open');
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PrefsProvider>
          <BrowserRouter>
            <Protected>
              <UploadsProvider>
              <Routes>
                <Route path="/" element={<AppShell><LibraryPage /></AppShell>} />
                <Route path="/anotacoes" element={<AppShell><NotesPage /></AppShell>} />
                <Route path="/estatisticas" element={<AppShell><StatsPage /></AppShell>} />
                <Route path="/ler/:id" element={<ReaderPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </UploadsProvider>
            </Protected>
          </BrowserRouter>
        </PrefsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
