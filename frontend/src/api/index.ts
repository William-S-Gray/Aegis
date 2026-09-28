import axios, { type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const SESSION_KEYS = ['token', 'user', 'refresh_token'] as const;

/** Every credential goes, including the 7-day refresh token. */
export const clearSession = () => SESSION_KEYS.forEach((key) => localStorage.removeItem(key));

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// Endpoints whose 401 means "wrong credentials", not "access token expired".
const NO_REFRESH = ['/auth/login', '/auth/refresh'];

let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) throw new Error('No refresh token');
  // Bare axios: the shared instance's interceptor would recurse on a 401.
  const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
    refresh_token: refreshToken,
  });
  localStorage.setItem('token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.access_token;
}

/**
 * A fresh access token for a request that was refused with `usedToken`.
 *
 * Refresh tokens rotate, so two tabs refreshing with the same one would sign
 * the slower tab out. If another tab has already stored a newer token, use it
 * instead of refreshing again.
 */
async function freshToken(usedToken: string | undefined): Promise<string> {
  const current = localStorage.getItem('token');
  if (current && `Bearer ${current}` !== usedToken) return current;
  // Single flight: ten parallel 401s trigger one refresh.
  refreshing ??= refreshAccessToken().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Attach the bearer token to every outgoing request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    /*
     * A single-page-app host answers unknown paths with index.html and HTTP 200.
     * Without this guard that HTML string flows into components as if it were
     * data — which is exactly how the analytics page used to white-screen
     * ("data.map is not a function" inside recharts). Treat it as an error.
     */
    const contentType = String(response.headers?.['content-type'] ?? '');
    if (contentType.includes('text/html')) {
      return Promise.reject(
        new Error(
          `Expected JSON from ${response.config?.url ?? 'the API'} but received HTML. ` +
            'The API base URL is probably misconfigured or the backend is not running.'
        )
      );
    }
    return response;
  },
  async (error) => {
    const original = error.config as RetriableConfig | undefined;

    // Access tokens live 15 minutes. Without this, every guard was sent to the
    // login page mid-shift, and a decision made at that moment was lost.
    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !NO_REFRESH.some((path) => original.url?.startsWith(path))
    ) {
      original._retried = true;
      try {
        const token = await freshToken(original.headers?.Authorization as string | undefined);
        original.headers.Authorization = `Bearer ${token}`;
        return await api(original);
      } catch (retryError) {
        // A retry that failed for another reason is that request's error.
        const status = (retryError as { response?: { status?: number } })?.response?.status;
        if (status !== undefined && status !== 401) return Promise.reject(retryError);
        // Otherwise the refresh itself failed: fall through to sign-out.
      }
    }

    if (error.response?.status === 401) {
      clearSession();
      // Preserve where the user was so they can be returned after signing in.
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
