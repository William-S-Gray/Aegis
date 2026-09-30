import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';

import GuardAlertHistory from '../pages/GuardAlertHistory';
import api from '../api';

describe('GuardAlertHistory', () => {
  it('records a triage verdict without changing the workflow status', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
      url === '/users'
        ? ({ data: [] } as never)
        : ({ data: { alerts: [{ id: 'a1', plate_number: 'AB12CD', status: 'closed', feedback_status: 'pending', comments: [] }], total: 1 } } as never)
    );
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);

    render(
      <ChakraProvider>
        <GuardAlertHistory />
      </ChakraProvider>
    );

    fireEvent.change(await screen.findByLabelText('Verdict for AB12CD'), { target: { value: 'false_alarm' } });

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/alerts/a1/status', { status: 'closed', feedback_status: 'false_alarm' })
    );
  });
});
