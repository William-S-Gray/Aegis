import React, { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import api from '../api';
import { apiMessage } from '../utils/safe';

// Matches the API's minimum (MIN_PASSWORD_LENGTH).
const MIN_PASSWORD = 12;

interface Props {
  user: { id: string; full_name: string; email: string };
  /** Hides delete for the signed-in admin; the API refuses it anyway. */
  isSelf: boolean;
  onDeleted: (id: string) => void;
}

function generatePassword(): string {
  // 18 random bytes, base64url: 24 characters, no ambiguous symbols to read aloud wrong.
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

/** Reset password and permanent delete for one row of the admin's user list. */
const UserAccountActions: React.FC<Props> = ({ user, isSelf, onDeleted }) => {
  const toast = useToast();
  const reset = useDisclosure();
  const remove = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const openReset = () => {
    setPassword(generatePassword());
    reset.onOpen();
  };

  const submitReset = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/password`, { password });
      toast({
        title: 'Password reset',
        description: `Give the new password to ${user.full_name}. Their other sessions were signed out.`,
        status: 'success',
      });
      reset.onClose();
    } catch (error) {
      toast({ title: 'Error', description: apiMessage(error, 'Failed to reset password'), status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/users/${user.id}`, { params: { permanent: true } });
      toast({ title: 'Account deleted', description: user.email, status: 'success' });
      remove.onClose();
      onDeleted(user.id);
    } catch (error) {
      toast({ title: 'Error', description: apiMessage(error, 'Failed to delete account'), status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="xs" variant="outline" onClick={openReset}>
        Reset password
      </Button>
      {!isSelf && (
        <Button size="xs" colorScheme="red" variant="ghost" onClick={remove.onOpen}>
          Delete
        </Button>
      )}

      <AlertDialog isOpen={reset.isOpen} leastDestructiveRef={cancelRef} onClose={reset.onClose}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader>Reset password for {user.full_name}</AlertDialogHeader>
            <AlertDialogBody>
              <FormControl>
                <FormLabel htmlFor={`pw-${user.id}`}>New password</FormLabel>
                <InputGroup>
                  <Input
                    id={`pw-${user.id}`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    fontFamily="mono"
                    pr="5.5rem"
                  />
                  <InputRightElement width="5.5rem">
                    <Button size="xs" onClick={() => setPassword(generatePassword())}>
                      Generate
                    </Button>
                  </InputRightElement>
                </InputGroup>
                <FormHelperText>
                  At least {MIN_PASSWORD} characters. Copy it now: it is not shown again.
                </FormHelperText>
              </FormControl>
            </AlertDialogBody>
            <AlertDialogFooter>
              <HStack>
                <Button ref={cancelRef} onClick={reset.onClose}>
                  Cancel
                </Button>
                <Button
                  colorScheme="blue"
                  onClick={submitReset}
                  isLoading={busy}
                  isDisabled={password.length < MIN_PASSWORD}
                >
                  Set password
                </Button>
              </HStack>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog isOpen={remove.isOpen} leastDestructiveRef={cancelRef} onClose={remove.onClose}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader>Delete {user.full_name} permanently?</AlertDialogHeader>
            <AlertDialogBody>
              <Text mb={2}>
                <b>{user.email}</b> will be removed and signed out everywhere. This cannot be undone.
              </Text>
              <Text fontSize="sm" color="text.muted">
                Their past gate decisions and alert notes stay, but without their name. To keep
                history attributed, use <b>Deactivate</b> instead.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter>
              <HStack>
                <Button ref={cancelRef} onClick={remove.onClose}>
                  Cancel
                </Button>
                <Button colorScheme="red" onClick={submitDelete} isLoading={busy}>
                  Delete permanently
                </Button>
              </HStack>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};

export default UserAccountActions;
