import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import OnSiteNow from '../components/OnSiteNow';
import VisitHistory from '../components/VisitHistory';
import api from '../api';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

beforeEach(() => vi.restoreAllMocks());

describe('OnSiteNow', () => {
  it('lists vehicles on site with how long, flagging a visitor whose pass ended', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [
        { id: 'v1', plate_number: 'AAA5329', entered_at: ago(90) },
        { id: 'v2', plate_number: 'ABC1234', entered_at: ago(30),
          visitor_pass: { visitor_name: 'Tendai M.', valid_until: ago(5) } },
      ],
    } as never);

    render(<ChakraProvider><OnSiteNow /></ChakraProvider>);

    expect(await screen.findByText('AAA5329')).toBeInTheDocument();
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument();
    expect(screen.getByText('Pass ended')).toBeInTheDocument();
  });
});

describe('VisitHistory', () => {
  it('shows each stay and the median', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { visits: [{ id: 'v1', plate_number: 'AAA5329', entered_at: ago(60), exited_at: ago(18) }],
              total: 1, median_minutes: 42 },
    } as never);

    render(<ChakraProvider><VisitHistory /></ChakraProvider>);

    expect(await screen.findByText('42 min')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
