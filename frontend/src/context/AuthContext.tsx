import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../api';
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
const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refresh_token';

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

  const persist = useCallback((userData: User, token: string, refreshToken?: string) => {
    setUser(userData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
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
        response = await api.post('/auth/login', { email: normalizedEmail, password });
      } catch (error) {
        // Surface the server's message (e.g. "Invalid email or password",
        // or the 429 lockout notice) rather than a generic network error.
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;
        throw new Error(detail || 'Unable to sign in. Please try again.');
      }

      const {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: userData,
      } = response.data ?? {};

      if (typeof accessToken !== 'string' || !isValidUser(userData)) {
        throw new Error('Malformed authentication response from server');
      }

      persist(userData, accessToken, refreshToken);
    },
    [persist]
  );

  const logout = useCallback(() => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);

    // Clear locally first so the UI never appears signed in while the network
    // call is in flight; revoking server-side is best effort.
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);

    if (!mockAuthEnabled && refreshToken) {
      api.post('/auth/logout', { refresh_token: refreshToken }).catch(() => {
        // Already signed out locally; nothing useful to do here.
      });
    }
  }, []);

  // Restore a previously stored session, rejecting anything malformed or
  // missing its token so a tampered localStorage entry cannot mint a role.
  useEffect(() => {
    const storedUser = localStorage.getItem(STORAGE_KEY);
    const storedToken = localStorage.getItem(TOKEN_KEY);

    if (storedUser && storedToken) {
      try {
        const parsed: unknown = JSON.parse(storedUser);
        if (isValidUser(parsed)) {
          setUser(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }

    setIsInitializing(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isInitializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
