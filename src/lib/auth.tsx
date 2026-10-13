import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post, setCsrf } from './api';

export type User = { id: string; email: string; name: string; role: 'admin' | 'speaker' | 'attendee' | 'checkin_staff'; title: string | null; org: string | null; bio: string | null; hasPhoto: boolean };
type Ctx = {
  user: User | null; loading: boolean;
  setSession: (r: { user: User | null; csrfToken: string | null }) => void;
  refresh: () => Promise<void>; logout: () => Promise<void>;
};
const AuthCtx = createContext<Ctx>(null as never);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const setSession = useCallback((r: { user: User | null; csrfToken: string | null }) => { setCsrf(r.csrfToken); setUser(r.user); }, []);
  const refresh = useCallback(async () => {
    try { setSession(await get('/api/auth/me')); } catch { setSession({ user: null, csrfToken: null }); } finally { setLoading(false); }
  }, [setSession]);
  useEffect(() => { void refresh(); }, [refresh]);
  const logout = useCallback(async () => { try { await post('/api/auth/logout'); } finally { setSession({ user: null, csrfToken: null }); } }, [setSession]);
  return <AuthCtx.Provider value={{ user, loading, setSession, refresh, logout }}>{children}</AuthCtx.Provider>;
}
