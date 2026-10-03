import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Regression coverage for the authentication bypass: the previous
 * implementation granted the `admin` role to ANY email/password pair whose
 * credentials did not match the demo list.
 */

async function loadAuth(mockEnabled: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_ENABLE_MOCK_AUTH', mockEnabled ? 'true' : 'false');
  return import('../context/AuthContext');
}

const wrapperFor =
  (AuthProvider: React.FC<{ children: ReactNode }>) =>
  ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe('AuthProvider with mock auth enabled', () => {
  it('rejects an unknown email instead of granting a role', async () => {
    const { AuthProvider, useAuth } = await loadAuth(true);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await expect(
      act(() => result.current.login('attacker@evil.test', 'totally-wrong-password'))
    ).rejects.toThrow(/invalid email or password/i);

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('rejects a known email with the wrong password', async () => {
    const { AuthProvider, useAuth } = await loadAuth(true);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await expect(
      act(() => result.current.login('admin@aegis.example', 'not-the-password'))
    ).rejects.toThrow();

    expect(result.current.user).toBeNull();
  });

  it('never assigns admin as a fallback role', async () => {
    const { AuthProvider, useAuth } = await loadAuth(true);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    for (const email of ['random@nowhere.test', 'guard@aegis.example', '']) {
      await act(() => result.current.login(email, 'wrong').catch(() => {}));
      expect(result.current.user?.role).not.toBe('admin');
    }
  });

  it('signs in a valid demo user with the correct role', async () => {
    const { AuthProvider, useAuth } = await loadAuth(true);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await act(() => result.current.login('guard@aegis.example', 'guard123'));

    expect(result.current.user).toMatchObject({ email: 'guard@aegis.example', role: 'guard' });
  });
});

describe('AuthProvider against the real API', () => {
  it('stores the user returned by a successful login', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_MOCK_AUTH', 'false');
    const api = (await import('../api')).default;
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { access_token: 'jwt-token', user: { id: 'u1', email: 'a@b.c', role: 'guard' } },
    } as never);

    const { AuthProvider, useAuth } = await import('../context/AuthContext');
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await act(() => result.current.login('a@b.c', 'pw'));

    expect(result.current.user).toMatchObject({ role: 'guard' });
    expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'a@b.c', password: 'pw', session: 'cookie' });
    // R-002: the token is held in memory, never in storage.
    expect((await import('../api')).getAccessToken()).toBe('jwt-token');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('surfaces the server error message on a rejected login', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_MOCK_AUTH', 'false');
    const api = (await import('../api')).default;
    vi.spyOn(api, 'post').mockRejectedValue({
      response: { status: 401, data: { detail: 'Invalid email or password' } },
    });

    const { AuthProvider, useAuth } = await import('../context/AuthContext');
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await expect(act(() => result.current.login('a@b.c', 'pw'))).rejects.toThrow(
      /invalid email or password/i
    );
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('revokes the cookie session on logout and forgets the token', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_MOCK_AUTH', 'false');
    const apiModule = await import('../api');
    vi.spyOn(apiModule.default, 'post').mockResolvedValue({
      data: { access_token: 'jwt-token', refresh_token: null, user: { id: 'u1', email: 'a@b.c', role: 'admin' } },
    } as never);

    const { AuthProvider, useAuth } = await import('../context/AuthContext');
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await act(() => result.current.login('a@b.c', 'pw'));
    await act(async () => result.current.logout());

    expect(apiModule.getAccessToken()).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(apiModule.default.post).toHaveBeenCalledWith(
      '/auth/logout',
      {},
      { headers: { 'X-Aegis-CSRF': '1', Authorization: 'Bearer jwt-token' } }
    );
  });

  it('throws when the server response is malformed', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_MOCK_AUTH', 'false');
    const api = (await import('../api')).default;
    vi.spyOn(api, 'post').mockResolvedValue({ data: { nonsense: true } } as never);

    const { AuthProvider, useAuth } = await import('../context/AuthContext');
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await expect(act(() => result.current.login('a@b.c', 'pw'))).rejects.toThrow(/malformed/i);
    expect(result.current.user).toBeNull();
  });
});

describe('session restoration (real API)', () => {
  const profile = { id: 'x', email: 'e@f.g', role: 'admin' };

  async function restoreWith(refresh: () => Promise<unknown>) {
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_MOCK_AUTH', 'false');
    const apiModule = await import('../api');
    vi.spyOn(apiModule, 'refreshSession').mockImplementation(refresh as never);
    const { AuthProvider, useAuth } = await import('../context/AuthContext');
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });
    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    return result;
  }

  it('signs in from the refresh cookie, whatever is stored', async () => {
    const result = await restoreWith(async () => ({ access_token: 't', user: { ...profile, role: 'guard' } }));

    expect(result.current.user).toMatchObject({ role: 'guard' });
  });

  it('a stored profile alone does not sign anyone in', async () => {
    localStorage.setItem('user', JSON.stringify(profile));
    localStorage.setItem('token', 'legacy-token');

    const result = await restoreWith(async () => Promise.reject({ response: { status: 401 } }));

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('keeps a guard signed in offline from the stored profile', async () => {
    localStorage.setItem('user', JSON.stringify(profile));

    const result = await restoreWith(async () => Promise.reject(new Error('Network Error')));

    expect(result.current.user).toMatchObject({ role: 'admin' });
  });

  it('ignores a stored profile whose role was tampered with, even offline', async () => {
    localStorage.setItem('user', JSON.stringify({ ...profile, role: 'superadmin' }));

    const result = await restoreWith(async () => Promise.reject(new Error('Network Error')));

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});
