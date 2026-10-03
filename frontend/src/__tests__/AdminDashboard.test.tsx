import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router-dom';
import type { AxiosRequestConfig } from 'axios';

import AdminDashboard from '../pages/AdminDashboard';
import api from '../api';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'admin' } }),
}));

describe('AdminDashboard', () => {
  it('shows alerts and access decisions from the API, never sample figures', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url: string, config?: AxiosRequestConfig) => {
      if (url === '/alerts') {
        return (config?.params as { feedback_status?: string } | undefined)?.feedback_status === 'pending'
          ? ({ data: { alerts: [], total: 7 } } as never)
          : ({ data: { alerts: [{ id: 'a1', plate_number: 'REAL123', mismatch_type: 'unregistered', status: 'open', timestamp: '2026-09-30T08:00:00Z' }], total: 1 } } as never);
      }
      if (url === '/logs') {
        return { data: { logs: [{ id: 'l1', plate_number: 'GATE42', timestamp: '2026-09-30T08:05:00Z', action: 'granted', user_id: 'u1', vehicle_id: 'v1' }], total: 1 } } as never;
      }
      return { data: url === '/users' ? [] : { vehicles: [], total: 0 } } as never;
    });

    render(
      <ChakraProvider>
        <MemoryRouter>
          <AdminDashboard />
        </MemoryRouter>
      </ChakraProvider>
    );

    expect(await screen.findByText('REAL123')).toBeInTheDocument();
    expect(await screen.findAllByText('GATE42')).not.toHaveLength(0);
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
    for (const fake of ['ABC-123', 'John Doe', 'Security Settings']) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
  });

  it('lists a vehicle without a colour, with its type and owner by name', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url === '/users') {
        return { data: [{ id: 'u1', full_name: 'Owner One', email: 'o@aegis.example', role: 'user', is_active: true }] } as never;
      }
      if (url === '/vehicles') {
        return { data: { vehicles: [{ id: 'v1', plate_number: 'NOCOL1', make: 'Ford', model: 'Transit', color: null, vehicle_type: 'van', owner_id: 'u1' }], total: 1 } } as never;
      }
      return { data: { alerts: [], logs: [], total: 0 } } as never;
    });

    render(
      <ChakraProvider>
        <MemoryRouter>
          <AdminDashboard />
        </MemoryRouter>
      </ChakraProvider>
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Vehicles' }));
    expect(await screen.findByText('NOCOL1')).toBeInTheDocument();
    expect(screen.getByText('van')).toBeInTheDocument();
    expect(screen.getAllByText('Owner One').length).toBeGreaterThan(0);
  });
});
