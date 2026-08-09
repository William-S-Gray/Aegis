import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The WebSocket URL is security-relevant: it must upgrade to wss on an https
 * deployment (or the browser blocks it as mixed content) and must carry only a
 * short-lived ticket, never the access token.
 */

async function loadConfig(apiUrl: string, wsUrl?: string) {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', apiUrl);
  if (wsUrl === undefined) {
    vi.stubEnv('VITE_WS_URL', '');
  } else {
    vi.stubEnv('VITE_WS_URL', wsUrl);
  }
  return import('../config');
}

afterEach(() => vi.unstubAllEnvs());

describe('WS_BASE_URL', () => {
  it('derives ws:// from an http API', async () => {
    const { WS_BASE_URL } = await loadConfig('http://localhost:8000/api/v1');
    expect(WS_BASE_URL).toBe('ws://localhost:8000/api/v1');
  });

  it('upgrades to wss:// for an https API', async () => {
    const { WS_BASE_URL } = await loadConfig('https://api.example.com/api/v1');
    expect(WS_BASE_URL).toBe('wss://api.example.com/api/v1');
    expect(WS_BASE_URL.startsWith('ws://')).toBe(false);
  });

  it('keeps the API version prefix so it matches the server route', async () => {
    const { WS_BASE_URL } = await loadConfig('https://api.example.com/api/v1');
    expect(WS_BASE_URL.endsWith('/api/v1')).toBe(true);
  });

  it('honours an explicit override', async () => {
    const { WS_BASE_URL } = await loadConfig(
      'https://api.example.com/api/v1',
      'wss://sockets.example.com/api/v1'
    );
    expect(WS_BASE_URL).toBe('wss://sockets.example.com/api/v1');
  });
});

describe('guardAlertsSocketUrl', () => {
  it('carries the ticket and encodes both parameters', async () => {
    const { guardAlertsSocketUrl } = await loadConfig('https://api.example.com/api/v1');
    const url = guardAlertsSocketUrl('guard id/1', 'tick et+value');

    expect(url).toContain('/ws/guard-alerts/guard%20id%2F1');
    expect(url).toContain('ticket=tick%20et%2Bvalue');
  });

  it('never places a bearer token in the URL', async () => {
    const { guardAlertsSocketUrl } = await loadConfig('https://api.example.com/api/v1');
    const url = guardAlertsSocketUrl('g1', 'short-lived-ticket');

    expect(url).not.toMatch(/token|authorization|bearer/i);
  });
});
