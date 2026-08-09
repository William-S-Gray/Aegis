import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ChakraProvider } from '@chakra-ui/react';
import { AuthProvider } from '../context/AuthContext';
import ProtectedRoute from '../components/ProtectedRoute';

/**
 * Regression coverage for the missing route guard: `/admin` previously
 * rendered the full admin dashboard with no session at all.
 */

function renderAt(path: string) {
  return render(
    <ChakraProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route path="/unauthorized" element={<div>access denied</div>} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['admin']}>
                  <div>admin dashboard</div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/guard"
              element={
                <ProtectedRoute roles={['admin', 'guard']}>
                  <div>guard dashboard</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ChakraProvider>
  );
}

function signInAs(role: string) {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'a@b.c', role }));
  localStorage.setItem('token', 'test-token');
}

beforeEach(() => localStorage.clear());

describe('ProtectedRoute', () => {
  it('redirects an anonymous visitor away from /admin', async () => {
    renderAt('/admin');
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
    expect(screen.queryByText('admin dashboard')).not.toBeInTheDocument();
  });

  it('blocks a signed-in guard from the admin-only route', async () => {
    signInAs('guard');
    renderAt('/admin');
    await waitFor(() => expect(screen.getByText('access denied')).toBeInTheDocument());
    expect(screen.queryByText('admin dashboard')).not.toBeInTheDocument();
  });

  it('allows an admin through', async () => {
    signInAs('admin');
    renderAt('/admin');
    await waitFor(() => expect(screen.getByText('admin dashboard')).toBeInTheDocument());
  });

  it('allows an admin onto a route shared with guards', async () => {
    signInAs('admin');
    renderAt('/guard');
    await waitFor(() => expect(screen.getByText('guard dashboard')).toBeInTheDocument());
  });

  it('blocks a plain user from the guard route', async () => {
    signInAs('user');
    renderAt('/guard');
    await waitFor(() => expect(screen.getByText('access denied')).toBeInTheDocument());
  });
});
