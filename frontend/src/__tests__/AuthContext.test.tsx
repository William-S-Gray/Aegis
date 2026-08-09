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
    expect(localStorage.getItem('token')).toBeTruthy();
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
    expect(localStorage.getItem('token')).toBe('jwt-token');
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

  it('stores the refresh token and revokes it on logout', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_MOCK_AUTH', 'false');
    const api = (await import('../api')).default;
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        access_token: 'jwt-token',
        refresh_token: 'refresh-value',
        user: { id: 'u1', email: 'a@b.c', role: 'admin' },
      },
    } as never);

    const { AuthProvider, useAuth } = await import('../context/AuthContext');
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await act(() => result.current.login('a@b.c', 'pw'));
    expect(localStorage.getItem('refresh_token')).toBe('refresh-value');

    await act(async () => result.current.logout());

    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.post).toHaveBeenCalledWith('/auth/logout', { refresh_token: 'refresh-value' });
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

describe('session restoration', () => {
  it('ignores a stored user whose role was tampered with', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'x', email: 'e@f.g', role: 'superadmin' }));
    localStorage.setItem('token', 'some-token');

    const { AuthProvider, useAuth } = await loadAuth(true);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('ignores a stored user with no accompanying token', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'x', email: 'e@f.g', role: 'admin' }));

    const { AuthProvider, useAuth } = await loadAuth(true);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('restores a well-formed session', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'x', email: 'e@f.g', role: 'admin' }));
    localStorage.setItem('token', 'good-token');

    const { AuthProvider, useAuth } = await loadAuth(true);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(AuthProvider) });

    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    expect(result.current.user).toMatchObject({ role: 'admin' });
  });
});
