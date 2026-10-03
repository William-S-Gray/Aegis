import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api, { clearSession, CSRF_HEADERS, getAccessToken, refreshSession, setAccessToken } from '../api';
import { mockAuthEnabled } from '../config';

export type Role = 'admin' | 'guard' | 'user';

export interface User {
  id: string;
  email: string;
  role: Role;
  full_name?: string;
}

interface AuthContextType {
  user: User | null;
  /** True until the stored session has been checked, so routes don't redirect prematurely. */
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const VALID_ROLES: Role[] = ['admin', 'guard', 'user'];
const STORAGE_KEY = 'user';

/**
 * Dev-only credential set. Enabled solely when VITE_ENABLE_MOCK_AUTH === 'true',
 * which must never be set in a deployed environment. Unlike the previous
 * implementation this fails closed: unknown users and bad passwords throw.
 */
const MOCK_USERS: Record<string, { password: string; role: Role; id: string }> = {
  'admin@aegis.example': { password: 'admin123', role: 'admin', id: 'mock-admin' },
  'guard@aegis.example': { password: 'guard123', role: 'guard', id: 'mock-guard' },
  'user@aegis.example': { password: 'user123', role: 'user', id: 'mock-user' },
};

function isValidUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.role === 'string' &&
    VALID_ROLES.includes(candidate.role as Role)
  );
}

// The provider and its hook belong together; splitting them only to satisfy
// the fast-refresh heuristic would hurt readability.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // The token stays in memory; only the profile is stored (see api/index.ts).
  const persist = useCallback((userData: User, token: string) => {
    setUser(userData);
    setAccessToken(token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();

      if (mockAuthEnabled) {
        const mockUser = MOCK_USERS[normalizedEmail];
        // Fail closed. No fallback role is ever granted.
        if (!mockUser || mockUser.password !== password) {
          throw new Error('Invalid email or password');
        }
        persist(
          { id: mockUser.id, email: normalizedEmail, role: mockUser.role },
          `mock-token.${mockUser.id}`
        );
        return;
      }

      let response;
      try {
        // "cookie": the refresh token comes back only as an httpOnly cookie.
        response = await api.post('/auth/login', { email: normalizedEmail, password, session: 'cookie' });
      } catch (error) {
        // Surface the server's message (e.g. "Invalid email or password",
        // or the 429 lockout notice) rather than a generic network error.
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;
        throw new Error(detail || 'Unable to sign in. Please try again.');
      }

      const { access_token: accessToken, user: userData } = response.data ?? {};

      if (typeof accessToken !== 'string' || !isValidUser(userData)) {
        throw new Error('Malformed authentication response from server');
      }

      persist(userData, accessToken);
    },
    [persist]
  );

  const logout = useCallback(() => {
    const token = getAccessToken();

    // Clear locally first so the UI never appears signed in while the network
    // call is in flight; revoking server-side is best effort.
    setUser(null);
    clearSession();

    if (!mockAuthEnabled) {
      // Revokes the refresh token and clears its cookie.
      api
        .post('/auth/logout', {}, { headers: { ...CSRF_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
        .catch(() => {
          // Already signed out locally; nothing useful to do here.
        });
    }
  }, []);

  // Restore the session from the refresh cookie. A stored profile alone never
  // signs anyone in: it is used only when the API cannot be reached, so a
  // guard can keep queueing decisions offline; the server checks every request.
  useEffect(() => {
    let cancelled = false;
    const stored = (() => {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        return isValidUser(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })();
    if (!stored) localStorage.removeItem(STORAGE_KEY);
    // Credentials from before the cookie session must not linger.
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');

    const restore = async () => {
      if (mockAuthEnabled) {
        if (stored) persist(stored, `mock-token.${stored.id}`);
        return;
      }
      try {
        const data = await refreshSession();
        if (!cancelled && isValidUser(data.user)) setUser(data.user);
      } catch (error) {
        const offline = !(error as { response?: unknown })?.response;
        if (cancelled) return;
        if (offline && stored) setUser(stored);
        else clearSession();
      }
    };
    restore().finally(() => !cancelled && setIsInitializing(false));
    return () => {
      cancelled = true;
    };
  }, [persist]);

  return (
    <AuthContext.Provider value={{ user, isInitializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
