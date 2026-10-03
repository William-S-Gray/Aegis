import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider } from '@chakra-ui/react';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'guard-1', email: 'g@aegis.example', role: 'guard' } }),
}));
vi.mock('../services/OfflineSyncService', () => ({ startOfflineSync: () => () => {} }));
vi.mock('../db', () => ({
  default: { access_logs_queue: { add: vi.fn() } },
  newClientRef: () => 'ref-1',
}));

import GuardDashboard from '../pages/GuardDashboard';
import api from '../api';

/** A WebSocket the test can push messages through. */
class FakeSocket {
  static latest: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() {
    FakeSocket.latest = this;
    setTimeout(() => this.onopen?.());
  }
  close() {}
  push(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const alertFor = (id: string, plate: string) => ({
  type: 'alert',
  alert: {
    id,
    plate_number: plate,
    mismatch_type: 'none',
    status: 'open',
    feedback_status: 'pending',
    timestamp: '2026-09-28T10:00:00Z',
  },
});

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
});

async function renderConnected(existing: ReturnType<typeof alertFor>['alert'][] = []) {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { alerts: existing } } as never);
  vi.spyOn(api, 'post').mockImplementation(async (url: string) =>
    url === '/auth/ws-ticket' ? ({ data: { ticket: 't' } } as never) : ({ data: {} } as never)
  );
  render(
    <ChakraProvider>
      <GuardDashboard />
    </ChakraProvider>
  );
  await waitFor(() => expect(FakeSocket.latest).not.toBeNull());
  return FakeSocket.latest!;
}

describe('GuardDashboard decisions', () => {
  it('an alert arriving mid-decision does not change which vehicle is approved', async () => {
    const socket = await renderConnected();

    act(() => socket.push(alertFor('a1', 'FIRST1')));
    expect(await screen.findByRole('heading', { name: 'FIRST1' })).toBeInTheDocument();

    // The next vehicle arrives while the guard is still reading the first.
    act(() => socket.push(alertFor('a2', 'SECOND2')));
    await userEvent.click(screen.getByRole('button', { name: 'Let in' }));

    const decision = vi.mocked(api.post).mock.calls.find(([url]) => url === '/access-logs');
    expect(decision?.[1]).toMatchObject({
      plate_number: 'FIRST1',
      action: 'approve',
      client_ref: 'ref-1',
      details: { alert_id: 'a1' },
    });
    // The second is shown next rather than lost.
    expect(await screen.findByRole('heading', { name: 'SECOND2' })).toBeInTheDocument();
  });

  it('a decision the server refuses is reported, not queued as offline', async () => {
    const socket = await renderConnected();
    const db = (await import('../db')).default;
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === '/auth/ws-ticket') return { data: { ticket: 't' } } as never;
      throw { response: { status: 422, data: { detail: 'timestamp is in the future' } } };
    });

    act(() => socket.push(alertFor('a1', 'FIRST1')));
    await userEvent.click(await screen.findByRole('button', { name: 'Turn away' }));

    expect(await screen.findByText('Decision not recorded')).toBeInTheDocument();
    expect(db.access_logs_queue.add).not.toHaveBeenCalled();
  });

  it('offers no controls that pretend to act', async () => {
    await renderConnected();

    // These reported success without doing anything: the emergency one most
    // dangerously of all.
    for (const label of [/Emergency Protocol/i, /Generate Report/i, /Guard Settings/i, /Refresh Systems/i]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

describe('GuardDashboard queue', () => {
  it('"decide later" keeps the vehicle in the queue instead of discarding it', async () => {
    const socket = await renderConnected();
    act(() => socket.push(alertFor('a1', 'FIRST1')));
    act(() => socket.push(alertFor('a2', 'SECOND2')));

    await userEvent.click(await screen.findByRole('button', { name: /decide later/i }));
    expect(await screen.findByRole('heading', { name: 'SECOND2' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /decide later/i }));
    expect(await screen.findByRole('heading', { name: 'FIRST1' })).toBeInTheDocument();
  });
});

describe('GuardDashboard recent alerts', () => {
  it('shows alerts from before the page loaded, without asking for a decision', async () => {
    // A guard signing in or refreshing used to see "No alerts yet" over a
    // board full of open alerts.
    const socket = await renderConnected([alertFor('old-1', 'EARLIER1').alert]);

    expect(await screen.findByText('EARLIER1')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'EARLIER1' })).toBeNull();

    // The same alert arriving live is not listed twice: once at the gate, once in the list.
    act(() => socket.push(alertFor('old-1', 'EARLIER1')));
    await screen.findByRole('heading', { name: 'EARLIER1' });
    expect(screen.getAllByText('EARLIER1')).toHaveLength(2);
  });
});

describe('GuardDashboard watchlist', () => {
  it('puts the watchlist reason in front of the guard', async () => {
    const socket = await renderConnected();
    const hit = alertFor('w1', 'ABC1234');

    act(() =>
      socket.push({
        ...hit,
        alert: { ...hit.alert, mismatch_type: 'watchlist', watchlist_entry: { reason: 'Reported stolen 30 Sep' } },
      })
    );

    expect(await screen.findByRole('heading', { name: 'ABC1234' })).toBeInTheDocument();
    expect(screen.getByText('WATCHLIST: Reported stolen 30 Sep')).toBeInTheDocument();
  });
});

describe('GuardDashboard automatic barrier', () => {
  it('lists a vehicle the barrier let in without asking the guard to decide', async () => {
    const socket = await renderConnected();
    const opened = alertFor('a9', 'AAA5329');

    act(() => socket.push({ ...opened, alert: { ...opened.alert, auto_opened: true } }));

    expect(await screen.findByText('Opened automatically')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AAA5329' })).toBeNull();
  });
});
