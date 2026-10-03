import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router-dom';

const user = { id: 'g1', email: 'guard@aegis.example', role: 'guard' };
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user, logout: vi.fn() }) }));

import Navbar from '../components/Navbar';
import api from '../api';

const renderNavbar = () =>
  render(
    <ChakraProvider>
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    </ChakraProvider>
  );

describe('Navbar system status', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Desktop: the status lights are hidden on phone widths.
    window.matchMedia = ((query: string) => ({
      // Chakra queries each breakpoint as a min-max range; only the open-ended
      // widest one should match.
      matches: query.includes('min-width') && !query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
      url === '/cameras' ? ({ data: [{ online: false }] } as never) : ({ data: [] } as never)
    );
  });

  it('shows the database as down when the API reports it unready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    renderNavbar();
    expect(await screen.findByLabelText('API: online')).toBeInTheDocument();
    expect(await screen.findByLabelText('Database: offline')).toBeInTheDocument();
    expect(await screen.findByLabelText('Cameras: offline')).toBeInTheDocument();
  });

  it('never shows green when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderNavbar();
    expect(await screen.findByLabelText('API: offline')).toBeInTheDocument();
    expect(screen.getByLabelText('Database: unknown')).toBeInTheDocument();
    expect(screen.queryByText(/maintenance scheduled/i)).not.toBeInTheDocument();
  });
});

describe('Navbar for a guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = ((query: string) => ({
      matches: query.includes('min-width') && !query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  it('links every page a guard uses, including alert history', () => {
    renderNavbar();
    for (const name of ['Gate', 'Plate review', 'Alert history']) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: /^Analytics/ })).toBeNull();
  });

  it('switches between light and dark mode', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    renderNavbar();
    const toggle = screen.getByRole('button', { name: /switch to (dark|light) mode/i });
    const before = toggle.getAttribute('aria-label');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /switch to (dark|light) mode/i }).getAttribute('aria-label')).not.toBe(before);
  });
});
