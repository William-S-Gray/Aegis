import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The API client must reject SPA fallback HTML. A dev/preview server answers
 * unknown paths with index.html and HTTP 200, which previously flowed into
 * components as if it were data.
 */

async function getInterceptors() {
  vi.resetModules();
  const api = (await import('../api')).default;
  // axios stores handlers in a private-ish array; index 0 is the one we added.
  const handlers = (api.interceptors.response as unknown as {
    handlers: { fulfilled: (r: unknown) => unknown; rejected: (e: unknown) => unknown }[];
  }).handlers;
  return handlers[0];
}

beforeEach(() => localStorage.clear());

describe('response interceptor', () => {
  it('rejects an HTML response', async () => {
    const { fulfilled } = await getInterceptors();
    const response = {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      config: { url: '/analytics/mismatches' },
      data: '<!doctype html>',
    };

    await expect(Promise.resolve(fulfilled(response))).rejects.toThrow(/received HTML/i);
  });

  it('passes a JSON response through', async () => {
    const { fulfilled } = await getInterceptors();
    const response = {
      headers: { 'content-type': 'application/json' },
      config: { url: '/users' },
      data: [{ id: 1 }],
    };

    await expect(Promise.resolve(fulfilled(response))).resolves.toBe(response);
  });

  it('clears the stored session on a 401', async () => {
    localStorage.setItem('token', 'stale');
    localStorage.setItem('user', '{"role":"admin"}');
    const { rejected } = await getInterceptors();

    await expect(
      Promise.resolve(rejected({ response: { status: 401 } })).catch((e) => {
        throw e;
      })
    ).rejects.toBeDefined();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});

describe('token refresh', () => {
  type Config = { url?: string; headers: Record<string, string> };
  const ok = (config: Config, data: unknown) => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    config,
  });
  const unauthorized = (config: Config) =>
    Object.assign(new Error('401'), {
      config,
      response: { status: 401, data: {}, headers: {}, config },
    });

  async function loadWith(adapter: (config: Config) => Promise<unknown>) {
    vi.resetModules();
    const axios = (await import('axios')).default;
    const api = (await import('../api')).default;
    axios.defaults.adapter = adapter as never;
    api.defaults.adapter = adapter as never;
    return api;
  }

  it('refreshes an expired access token once and retries the request', async () => {
    localStorage.setItem('token', 'expired');
    localStorage.setItem('refresh_token', 'r1');
    const seen: string[] = [];

    const api = await loadWith(async (config) => {
      seen.push(`${config.url} ${config.headers.Authorization ?? ''}`.trim());
      if (config.url?.endsWith('/auth/refresh')) {
        return ok(config, {
          access_token: 'fresh',
          refresh_token: 'r2',
          user: { id: 'u1', email: 'g@aegis.example', role: 'guard' },
        });
      }
      if (config.headers.Authorization === 'Bearer expired') throw unauthorized(config);
      return ok(config, { ok: true });
    });

    const { data } = await api.get('/vehicles');

    expect(data).toEqual({ ok: true });
    expect(localStorage.getItem('token')).toBe('fresh');
    expect(localStorage.getItem('refresh_token')).toBe('r2');
    expect(seen.filter((line) => line.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('parallel expiries trigger a single refresh', async () => {
    localStorage.setItem('token', 'expired');
    localStorage.setItem('refresh_token', 'r1');
    let refreshes = 0;

    const api = await loadWith(async (config) => {
      if (config.url?.endsWith('/auth/refresh')) {
        refreshes += 1;
        return ok(config, { access_token: 'fresh', refresh_token: 'r2', user: {} });
      }
      if (config.headers.Authorization === 'Bearer expired') throw unauthorized(config);
      return ok(config, {});
    });

    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

    expect(refreshes).toBe(1);
  });

  it('clears every credential, refresh token included, when refresh fails', async () => {
    localStorage.setItem('token', 'expired');
    localStorage.setItem('user', '{}');
    localStorage.setItem('refresh_token', 'revoked');

    const api = await loadWith(async (config) => {
      throw unauthorized(config);
    });

    await expect(api.get('/vehicles')).rejects.toBeDefined();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('a failed login is not treated as an expired session', async () => {
    let refreshes = 0;
    const api = await loadWith(async (config) => {
      if (config.url?.endsWith('/auth/refresh')) refreshes += 1;
      throw unauthorized(config);
    });

    await expect(api.post('/auth/login', {})).rejects.toBeDefined();
    expect(refreshes).toBe(0);
  });
});
