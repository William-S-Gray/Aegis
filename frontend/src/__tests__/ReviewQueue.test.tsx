import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider } from '@chakra-ui/react';
import ReviewQueue from '../pages/ReviewQueue';
import api from '../api';

const alertFixture = {
  id: 'alert-1',
  plate_number: 'A812CD',
  detected_type: 'sedan',
  detected_color: 'white',
  registered_type: null,
  registered_color: null,
  plate_confidence: 0.7,
  type_confidence: 0.8,
  mismatch_type: 'unregistered',
  review_reason: 'low_plate_confidence',
  detector_name: 'yolo',
  detector_version: 'plates-v3.pt',
  timestamp: '2026-08-08T10:00:00Z',
};

function renderPage() {
  return render(
    <ChakraProvider>
      <ReviewQueue />
    </ChakraProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ReviewQueue', () => {
  it('shows queued reads with why they were held back', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [alertFixture] } as never);

    renderPage();

    expect(await screen.findByText('A812CD')).toBeInTheDocument();
    expect(screen.getByText(/plate read was uncertain/i)).toBeInTheDocument();
    expect(screen.getByText(/Not registered/i)).toBeInTheDocument();
  });

  it('does not pre-fill the machine reading', async () => {
    // A pre-filled box turned review into one click on the detector's guess.
    vi.spyOn(api, 'get').mockResolvedValue({ data: [alertFixture] } as never);

    renderPage();

    const input = (await screen.findByPlaceholderText(/plate as you read it/i)) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('warns when no image of the plate was captured', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/crop')) throw { response: { status: 404 } };
      return { data: [alertFixture] } as never;
    });

    renderPage();

    expect(await screen.findByText(/no image was captured/i)).toBeInTheDocument();
  });

  it('drops a row someone else already reviewed', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [alertFixture] } as never);
    vi.spyOn(api, 'post').mockRejectedValue({
      response: { status: 409, data: { detail: 'This alert is not awaiting review' } },
    });

    renderPage();
    const user = userEvent.setup();

    await user.type(await screen.findByPlaceholderText(/plate as you read it/i), 'A812CD');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(screen.queryByText('A812CD')).not.toBeInTheDocument());
  });

  it('submits a correction and removes the row', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [alertFixture] } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { ...alertFixture, plate_number: 'AB12CD', mismatch_type: 'none' },
    } as never);

    renderPage();
    const user = userEvent.setup();

    const input = await screen.findByPlaceholderText(/plate as you read it/i);
    await user.clear(input);
    await user.type(input, 'AB12CD');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/alerts/alert-1/confirm-plate', {
        plate_number: 'AB12CD',
      })
    );
    await waitFor(() => expect(screen.queryByText('A812CD')).not.toBeInTheDocument());
  });

  it('warns before saving when the plate has been edited', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [alertFixture] } as never);

    renderPage();
    const user = userEvent.setup();

    const input = await screen.findByPlaceholderText(/plate as you read it/i);
    await user.clear(input);
    await user.type(input, 'AB12CD');

    expect(screen.getByText(/recorded as a correction/i)).toBeInTheDocument();
  });

  it('keeps the row when saving fails', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [alertFixture] } as never);
    vi.spyOn(api, 'post').mockRejectedValue({
      response: { data: { detail: 'Alert not found' } },
    });

    renderPage();
    const user = userEvent.setup();

    await user.type(await screen.findByPlaceholderText(/plate as you read it/i), 'A812CD');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    // The operator must not believe a failed save succeeded.
    await waitFor(() => expect(screen.getByText('A812CD')).toBeInTheDocument());
  });

  it('shows an empty state when nothing is waiting', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never);

    renderPage();

    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of showing a false empty state', async () => {
    vi.spyOn(api, 'get').mockRejectedValue({
      response: { data: { detail: 'Could not load the review queue' } },
    });

    renderPage();

    expect(await screen.findByText(/could not load the review queue/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing waiting/i)).not.toBeInTheDocument();
  });

  it('tolerates a malformed response without crashing', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: '<!doctype html>' } as never);

    renderPage();

    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });
});
