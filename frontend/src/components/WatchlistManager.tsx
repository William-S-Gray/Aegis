import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, FormControl, FormLabel, HStack, Input, Table, Tbody, Td, Text, Th, Thead, Tr, useToast,
} from '@chakra-ui/react';
import api from '../api';
import { apiMessage, asArray } from '../utils/safe';

interface Entry {
  id: string;
  plate_display: string;
  reason: string;
  created_at: string;
}

/**
 * Plates flagged on sight. A camera read of one raises a WATCHLIST alert,
 * outranking everything else, and a critical alert to the on-call channel.
 */
const WatchlistManager: React.FC = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [plate, setPlate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setEntries(asArray<Entry>((await api.get('/watchlist')).data));
    } catch (err) {
      toast({ title: 'Could not load the watchlist', description: apiMessage(err, ''), status: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/watchlist', { plate_number: plate, reason });
      toast({ title: `${plate} is on the watchlist`, status: 'success' });
      setPlate('');
      setReason('');
      load();
    } catch (err) {
      toast({ title: 'Not added', description: apiMessage(err, 'Check the details'), status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: Entry) => {
    try {
      await api.post(`/watchlist/${entry.id}/remove`);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      toast({ title: 'Not removed', description: apiMessage(err, ''), status: 'error' });
    }
  };

  return (
    <Box>
      <Text color="gray.600" mb={4}>
        Plates flagged on sight (stolen, banned, wanted). A camera read raises a WATCHLIST alert
        for the guards and pages the on-call channel. The plate itself is never sent off-site.
      </Text>
      <HStack as="form" onSubmit={add} align="end" spacing={3} mb={6} wrap="wrap">
        <FormControl isRequired maxW="200px">
          <FormLabel>Plate</FormLabel>
          <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC 1234" />
        </FormControl>
        <FormControl isRequired maxW="420px">
          <FormLabel>Reason (shown to guards)</FormLabel>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
            placeholder="e.g. Reported stolen 30 Sep, call police" />
        </FormControl>
        <Button type="submit" colorScheme="red" isLoading={saving}>Add to watchlist</Button>
      </HStack>

      {entries.length === 0 ? (
        <Text color="gray.500">No plates on the watchlist.</Text>
      ) : (
        <Table size="sm">
          <Thead><Tr><Th>Plate</Th><Th>Reason</Th><Th>Added</Th><Th /></Tr></Thead>
          <Tbody>
            {entries.map((e) => (
              <Tr key={e.id}>
                <Td fontFamily="mono" fontWeight="bold">{e.plate_display}</Td>
                <Td>{e.reason}</Td>
                <Td>{new Date(e.created_at).toLocaleDateString()}</Td>
                <Td textAlign="right">
                  <Button size="xs" variant="outline" onClick={() => remove(e)}>Remove</Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Box>
  );
};

export default WatchlistManager;
