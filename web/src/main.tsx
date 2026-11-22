import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import { PrefsProvider } from './lib/prefs';
import { LoginPage } from './pages/LoginPage';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="splash">❦</div>;
  if (!user) return <LoginPage />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PrefsProvider>
          <BrowserRouter>
            <Protected>
              <Routes>
                <Route path="/" element={<LibraryPage />} />
                <Route path="/ler/:id" element={<ReaderPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Protected>
          </BrowserRouter>
        </PrefsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
