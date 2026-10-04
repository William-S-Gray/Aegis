import React, { useState } from 'react';
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Input,
  VStack,
  useToast,
} from '@chakra-ui/react';
import api, { setAccessToken } from '../api';
import { apiMessage } from '../utils/safe';

// Matches the API's minimum (MIN_PASSWORD_LENGTH).
const MIN_PASSWORD = 12;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Change your own password. Other devices are signed out; this one carries on. */
const ChangePasswordDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && next.length >= MIN_PASSWORD && confirm === next;

  const close = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const { data } = await api.post<{ access_token: string }>('/auth/password', {
        current_password: current,
        new_password: next,
      });
      // The old session tokens were revoked; keep working with the new ones.
      setAccessToken(data.access_token);
      toast({ title: 'Password changed', description: 'Your other devices have been signed out.', status: 'success' });
      close();
    } catch (error) {
      toast({ title: 'Password not changed', description: apiMessage(error, 'Please try again'), status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} size="md">
      <ModalOverlay />
      <ModalContent as="form" onSubmit={submit}>
        <ModalHeader>Change password</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4}>
            <FormControl isRequired>
              <FormLabel>Current password</FormLabel>
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </FormControl>
            <FormControl isRequired isInvalid={tooShort}>
              <FormLabel>New password</FormLabel>
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              {tooShort ? (
                <FormErrorMessage>At least {MIN_PASSWORD} characters.</FormErrorMessage>
              ) : (
                <FormHelperText>At least {MIN_PASSWORD} characters. A short sentence is easy to remember.</FormHelperText>
              )}
            </FormControl>
            <FormControl isRequired isInvalid={mismatch}>
              <FormLabel>New password again</FormLabel>
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <FormErrorMessage>The two new passwords don't match.</FormErrorMessage>
            </FormControl>
          </VStack>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" colorScheme="brand" isLoading={busy} isDisabled={!ready}>
            Change password
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ChangePasswordDialog;
