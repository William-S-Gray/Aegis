import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider } from '@chakra-ui/react';
import UserAccountActions from '../components/UserAccountActions';
import api from '../api';

const guard = { id: 'u1', full_name: 'Gate Guard', email: 'guard@example.com' };
const renderIt = (isSelf = false, onDeleted = vi.fn()) =>
  render(<ChakraProvider><UserAccountActions user={guard} isSelf={isSelf} onDeleted={onDeleted} /></ChakraProvider>);

beforeEach(() => vi.restoreAllMocks());

describe('UserAccountActions', () => {
  it('resets a password with a generated one the admin can see', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);
    renderIt();

    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    const field = await screen.findByLabelText('New password');
    const generated = (field as HTMLInputElement).value;
    expect(generated.length).toBeGreaterThanOrEqual(12);

    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/users/u1/password', { password: generated }));
  });

  it('will not submit a password shorter than the minimum', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    const field = await screen.findByLabelText('New password');
    await userEvent.clear(field);
    await userEvent.type(field, 'short');
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
  });

  it('deletes permanently only after confirming', async () => {
    const del = vi.spyOn(api, 'delete').mockResolvedValue({ data: {} } as never);
    const onDeleted = vi.fn();
    renderIt(false, onDeleted);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/users/u1', { params: { permanent: true } }));
    expect(onDeleted).toHaveBeenCalledWith('u1');
  });

  it('offers no delete on your own account', () => {
    renderIt(true);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
