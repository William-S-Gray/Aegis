import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@aegis.example', role: 'user' } }),
}));

import UserPortal from '../pages/UserPortal';
import api from '../api';

describe('UserPortal', () => {
  it('renders a vehicle registered without a colour', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
      url === '/vehicles'
        ? ({ data: { vehicles: [{ id: 'v1', plate_number: 'AB12CD', make: 'Ford', model: 'Focus', color: null, owner_id: 'u1' }] } } as never)
        : ({ data: { logs: [], total: 0 } } as never)
    );

    render(
      <ChakraProvider>
        <UserPortal />
      </ChakraProvider>
    );

    expect(await screen.findByText('AB12CD')).toBeInTheDocument();
    expect(screen.getByText(/colour not recorded/i)).toBeInTheDocument();
  });
});
