import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider } from '@chakra-ui/react';

// The in-browser reader, replaced: it reads "KDA 101A" from any photo. Shaped
// like the real browser build, which has only a default export.
vi.mock('tesseract.js', () => ({
  default: {
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3' },
    createWorker: vi.fn(async () => ({
      setParameters: vi.fn(async () => undefined),
      recognize: vi.fn(async () => ({ data: { text: 'TOYOTA\nKDA 101A\n' } })),
    })),
  },
}));

import DeviceScanner from '../components/DeviceScanner';
import api from '../api';

const renderIt = (onClose = vi.fn()) =>
  render(<ChakraProvider><DeviceScanner isOpen onClose={onClose} /></ChakraProvider>);

function giveDeviceACamera(getUserMedia: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(getUserMedia) } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom has no camera or video decoding: a 1280x720 "picture" that plays.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 });
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
});

describe('DeviceScanner', () => {
  it('reads the plate from a photo and checks it like a camera read', async () => {
    giveDeviceACamera(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { plate_number: 'KDA101A', mismatch_type: 'none' } } as never);
    const onClose = vi.fn();
    renderIt(onClose);

    await userEvent.click(await screen.findByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Plate')).toHaveValue('KDA101A'));
    await userEvent.click(screen.getByRole('button', { name: 'Check plate' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/alerts', expect.objectContaining({ plate_number: 'KDA101A' })));
    expect(onClose).toHaveBeenCalled();
  });

  it('the guard can correct what was read before checking', async () => {
    giveDeviceACamera(async () => ({ getTracks: () => [] }));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { plate_number: 'KDA101B', mismatch_type: 'unregistered' } } as never);
    renderIt();

    await userEvent.click(await screen.findByRole('button', { name: 'Take photo' }));
    const field = screen.getByLabelText('Plate');
    await waitFor(() => expect(field).toHaveValue('KDA101A'));
    await userEvent.clear(field);
    await userEvent.type(field, 'kda101b');
    await userEvent.click(screen.getByRole('button', { name: 'Check plate' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/alerts', expect.objectContaining({ plate_number: 'KDA101B' })));
  });

  it('explains a refused camera instead of failing silently', async () => {
    giveDeviceACamera(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    renderIt();

    expect(await screen.findByText(/camera access was refused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
