import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider } from '@chakra-ui/react';
import VisitorPasses from '../components/VisitorPasses';
import api from '../api';

const pass = {
  id: 'p1',
  plate_display: 'ABC 1234',
  visitor_name: 'Tendai M.',
  valid_from: '2026-10-02T08:00:00Z',
  valid_until: '2026-10-02T17:00:00Z',
};

const renderIt = () => render(<ChakraProvider><VisitorPasses /></ChakraProvider>);

beforeEach(() => vi.restoreAllMocks());

describe('VisitorPasses', () => {
  it('lists expected visitors and cancels one', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [pass] } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);

    renderIt();
    expect(await screen.findByText('Tendai M.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(post).toHaveBeenCalledWith('/visitor-passes/p1/revoke');
    await waitFor(() => expect(screen.queryByText('Tendai M.')).toBeNull());
  });

  it('adds a visitor with a timezone-aware window', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);

    renderIt();
    await userEvent.type(screen.getByLabelText(/visitor's plate/i), 'ABC 1234');
    await userEvent.type(screen.getByLabelText(/visitor's name/i), 'Tendai M.');
    await userEvent.click(screen.getByRole('button', { name: 'Add visitor' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, Record<string, string>];
    expect(url).toBe('/visitor-passes');
    expect(body).toMatchObject({ plate_number: 'ABC 1234', visitor_name: 'Tendai M.' });
    // The API refuses timestamps without a zone; toISOString always has one.
    expect(body.valid_from).toMatch(/Z$/);
    expect(new Date(body.valid_until).getTime()).toBeGreaterThan(new Date(body.valid_from).getTime());
  });
});
