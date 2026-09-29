/**
 * Single source of truth for backend endpoints.
 *
 * Values are resolved at RUNTIME from `window.__AEGIS_CONFIG__`, falling back
 * to build-time Vite variables.
 *
 * This matters for shipping a container: Vite inlines `import.meta.env` at
 * build time, so a build-time-only image is welded to whatever API URL was set
 * when it was compiled and needs rebuilding per environment. The Docker image
 * writes `config.js` from environment variables on start, so one artefact
 * promotes unchanged from staging to production.
 */

declare global {
  interface Window {
    __AEGIS_CONFIG__?: Record<string, string | undefined>;
  }
}

function runtimeValue(key: string, buildTimeValue: string | undefined): string {
  const injected =
    typeof window !== 'undefined' ? window.__AEGIS_CONFIG__?.[key] : undefined;

  // The placeholder survives when the entrypoint did not substitute a value,
  // so it must not be mistaken for real configuration.
  if (injected && !injected.startsWith('__') && injected !== 'undefined') {
    return injected;
  }
  return buildTimeValue ?? '';
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** REST base, e.g. https://api.example.com/api/v1 */
export const API_BASE_URL = stripTrailingSlash(
  runtimeValue('API_URL', import.meta.env.VITE_API_URL) || 'http://localhost:8000/api/v1'
);

/**
 * WebSocket base, including the API's version prefix so it lines up with the
 * server's route. Derived from the API URL when not set explicitly, so an https
 * deployment automatically upgrades to wss instead of being blocked as mixed
 * content.
 */
export const WS_BASE_URL = stripTrailingSlash(
  runtimeValue('WS_URL', import.meta.env.VITE_WS_URL) ||
    (() => {
      try {
        const api = new URL(API_BASE_URL, window.location.href);
        const protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${api.host}${stripTrailingSlash(api.pathname)}`;
      } catch {
        return 'ws://localhost:8000/api/v1';
      }
    })()
);

/**
 * The ticket is a single-use, ~30s handle obtained from POST /auth/ws-ticket.
 * The access token itself is never placed in the URL, where it would be
 * captured by proxy logs, server access logs, and browser history.
 */
export const guardAlertsSocketUrl = (guardId: string, ticket: string): string =>
  `${WS_BASE_URL}/ws/guard-alerts/${encodeURIComponent(guardId)}` +
  `?ticket=${encodeURIComponent(ticket)}`;

/**
 * Dev-only mock authentication switch. Must be false in any deployed
 * environment; see .env.example.
 */
export const mockAuthEnabled =
  runtimeValue('ENABLE_MOCK_AUTH', import.meta.env.VITE_ENABLE_MOCK_AUTH) === 'true';
