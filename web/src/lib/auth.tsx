import { createContext, useContext, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });

  const onAuthed = (r: { user: User }) => {
    qc.clear();
    qc.setQueryData(['me'], r.user);
  };

  const loginM = useMutation({
    mutationFn: (v: { email: string; password: string }) => api<{ user: User }>('/auth/login', { method: 'POST', json: v }),
    onSuccess: onAuthed,
  });
  const registerM = useMutation({
    mutationFn: (v: { email: string; password: string; name?: string }) =>
      api<{ user: User }>('/auth/register', { method: 'POST', json: v }),
    onSuccess: onAuthed,
  });

  const value: AuthState = {
    user: me.data ?? null,
    loading: me.isLoading,
    login: async (email, password) => void (await loginM.mutateAsync({ email, password })),
    register: async (email, password, name) => void (await registerM.mutateAsync({ email, password, name })),
    logout: async () => {
      await api('/auth/logout', { method: 'POST' });
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
