import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider } from '@chakra-ui/react';
import WatchlistManager from '../components/WatchlistManager';
import api from '../api';

const entry = { id: 'w1', plate_display: 'ABC 1234', reason: 'Reported stolen', created_at: '2026-10-02T08:00:00Z' };
const renderIt = () => render(<ChakraProvider><WatchlistManager /></ChakraProvider>);

beforeEach(() => vi.restoreAllMocks());

describe('WatchlistManager', () => {
  it('adds a plate with its reason', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);

    renderIt();
    await userEvent.type(screen.getByLabelText(/^plate/i), 'ABC 1234');
    await userEvent.type(screen.getByLabelText(/reason/i), 'Reported stolen');
    await userEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/watchlist', { plate_number: 'ABC 1234', reason: 'Reported stolen' }));
  });

  it('removes a plate', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [entry] } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);

    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(post).toHaveBeenCalledWith('/watchlist/w1/remove');
    await waitFor(() => expect(screen.queryByText('ABC 1234')).toBeNull());
  });
});
