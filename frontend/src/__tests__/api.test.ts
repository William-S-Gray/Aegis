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
