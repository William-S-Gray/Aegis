import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';

import CameraPanel from '../components/CameraPanel';
import api from '../api';

const renderPanel = () =>
  render(
    <ChakraProvider>
      <CameraPanel />
    </ChakraProvider>
  );

describe('CameraPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:frame-1');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows the selected camera through the authenticated API client', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
      url === '/cameras'
        ? ({ data: [{ id: 'main-gate', name: 'Main Gate', online: true, last_frame_at: 0 }] } as never)
        : ({ data: new Blob(['jpeg']) } as never)
    );

    renderPanel();

    const img = await screen.findByAltText('Live view: Main Gate');
    expect(img).toHaveAttribute('src', 'blob:frame-1');
    expect(get).toHaveBeenCalledWith('/cameras/main-gate/frame', { responseType: 'blob' });
    expect(screen.getByText('online')).toBeInTheDocument();
  });

  it('says a camera is offline instead of showing a stale frame', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url === '/cameras') {
        return { data: [{ id: 'back-gate', name: 'Back Gate', online: false, last_frame_at: 0 }] } as never;
      }
      throw new Error('404');
    });

    renderPanel();

    expect(await screen.findByText('Back Gate is offline')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith('/cameras/back-gate/frame', expect.anything());
  });

  it('explains when no camera has reported yet', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never);
    renderPanel();
    await waitFor(() => expect(screen.getByText('No cameras reporting')).toBeInTheDocument());
  });
});

describe('CameraPanel restart', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('asks the gate to restart an offline camera', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [{ id: 'back-gate', name: 'Back Gate', online: false, last_frame_at: 0 }],
    } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);

    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Restart this camera' }));

    expect(post).toHaveBeenCalledWith('/cameras/back-gate/restart');
  });

  it('asks to restart every camera when none is reporting, and offers the device scanner', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);
    const scan = vi.fn();

    render(
      <ChakraProvider>
        <CameraPanel onScanWithDevice={scan} />
      </ChakraProvider>
    );
    await screen.findByText('No cameras reporting');
    await userEvent.click(screen.getByRole('button', { name: 'Restart cameras' }));
    expect(post).toHaveBeenCalledWith('/cameras/restart');

    await userEvent.click(screen.getByRole('button', { name: 'Scan with this device' }));
    expect(scan).toHaveBeenCalled();
  });
});
