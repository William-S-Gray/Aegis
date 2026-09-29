import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router-dom';
import type { AxiosRequestConfig } from 'axios';

import AdminDashboard from '../pages/AdminDashboard';
import api from '../api';

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
});
