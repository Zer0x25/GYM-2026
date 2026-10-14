/**
 * Session context for the whole app: who is signed in, with which role and
 * in which organization. Consumed by guards and panels.
 *
 * The session is server state (verified from stored data on every request —
 * see docs/api/README.md); this context only mirrors it. On 401 from any
 * call, the app treats the session as expired and bounces to /login.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, type SessionData } from "./api.js";

interface SessionState {
  session: SessionData | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setSession(await api.session());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession(null);
      // Network blip: keep the last known session; the next call decides.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const expire = () => setSession(null);
    const reconnect = () => void reload();
    window.addEventListener("gym:session-expired", expire);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("gym:session-expired", expire);
      window.removeEventListener("online", reconnect);
    };
  }, [reload]);

  const signIn = useCallback(async (email: string, password: string) => {
    await api.signIn(email, password);
    setSession(await api.session());
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(null);
  }, []);

  const value = useMemo<SessionState>(
    () => ({ session, loading, signIn, signOut, reload }),
    [session, loading, signIn, signOut, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
