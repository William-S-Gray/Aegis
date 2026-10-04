import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider } from '@chakra-ui/react';
import ChangePasswordDialog from '../components/ChangePasswordDialog';
import api, * as apiModule from '../api';

const renderIt = (onClose = vi.fn()) =>
  render(<ChakraProvider><ChangePasswordDialog isOpen onClose={onClose} /></ChakraProvider>);

beforeEach(() => vi.restoreAllMocks());

describe('ChangePasswordDialog', () => {
  it('changes the password and keeps this session with the new token', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { access_token: 'fresh' } } as never);
    const setToken = vi.spyOn(apiModule, 'setAccessToken');
    const onClose = vi.fn();
    renderIt(onClose);

    await userEvent.type(screen.getByLabelText(/current password/i), 'old-password-123');
    await userEvent.type(screen.getByLabelText(/^new password\s*\*?$/i), 'a-brand-new-passphrase');
    await userEvent.type(screen.getByLabelText(/new password again/i), 'a-brand-new-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/auth/password', {
        current_password: 'old-password-123',
        new_password: 'a-brand-new-passphrase',
      })
    );
    expect(setToken).toHaveBeenCalledWith('fresh');
    expect(onClose).toHaveBeenCalled();
  });

  it('will not submit until the new password is long enough and typed twice the same', async () => {
    renderIt();
    const submit = screen.getByRole('button', { name: 'Change password' });

    await userEvent.type(screen.getByLabelText(/current password/i), 'old-password-123');
    await userEvent.type(screen.getByLabelText(/^new password\s*\*?$/i), 'short');
    expect(submit).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/^new password\s*\*?$/i));
    await userEvent.type(screen.getByLabelText(/^new password\s*\*?$/i), 'a-brand-new-passphrase');
    await userEvent.type(screen.getByLabelText(/new password again/i), 'a-different-passphrase');
    expect(submit).toBeDisabled();
    expect(screen.getByText(/don't match/i)).toBeInTheDocument();
  });
});
