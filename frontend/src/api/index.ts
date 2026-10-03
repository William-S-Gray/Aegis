import axios, { type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  // The refresh cookie is scoped to /api/v1/auth, so it goes nowhere else.
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/*
 * R-002: the 15-minute access token lives only in this module's memory, and
 * the 7-day refresh token only in an httpOnly cookie the API sets, so no
 * script can read either from storage. A reload gets a new access token from
 * the cookie. The user profile (not a credential) stays in localStorage so a
 * guard can still use the console while offline.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

/** Sent with cookie-based refresh and logout; a cross-site page cannot add it. */
export const CSRF_HEADERS = { 'X-Aegis-CSRF': '1' };

// 'token' and 'refresh_token' are from before the cookie session; removed on
// sight so an upgraded browser keeps no credential in storage.
const SESSION_KEYS = ['user', 'token', 'refresh_token'] as const;

/** Every credential goes. The cookie is revoked by /auth/logout. */
export const clearSession = () => {
  accessToken = null;
  SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
};

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// Endpoints whose 401 means "wrong credentials", not "access token expired".
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout'];

/**
 * A new access token from the refresh cookie. Refresh tokens rotate and the
 * cookie is shared by every tab, so tabs take turns (Web Locks): a second tab
 * then refreshes with the already-rotated cookie instead of a spent one.
 */
export async function refreshSession(): Promise<{ access_token: string; user: unknown }> {
  const run = async () => {
    // Bare axios: the shared instance's interceptor would recurse on a 401.
    const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, {
      headers: CSRF_HEADERS,
      withCredentials: true,
    });
    accessToken = data.access_token;
    localStorage.setItem('user', JSON.stringify(data.user));
    return data;
  };
  return navigator.locks ? navigator.locks.request('aegis-refresh', run) : run();
}

let refreshing: Promise<string> | null = null;

/** Single flight: ten parallel 401s trigger one refresh. */
function freshToken(): Promise<string> {
  refreshing ??= refreshSession()
    .then((data) => data.access_token)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// Attach the bearer token to every outgoing request.
api.interceptors.request.use((config) => {
  if (accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${accessToken}`;
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
        const token = await freshToken();
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
