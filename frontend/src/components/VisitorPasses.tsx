import React, { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, CardBody, CardHeader, FormControl, FormLabel, Heading, HStack,
  Icon, Input, SimpleGrid, Text, useToast, VStack,
} from '@chakra-ui/react';
import { FiUserPlus } from 'react-icons/fi';
import api from '../api';
import { apiMessage, asArray } from '../utils/safe';

interface VisitorPass {
  id: string;
  plate_display: string;
  visitor_name: string;
  notes?: string | null;
  valid_from: string;
  valid_until: string;
  host_name?: string | null;
}

// <input type="datetime-local"> works in local time without a zone.
const toLocalInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const emptyForm = () => {
  const now = new Date();
  return {
    plate_number: '',
    visitor_name: '',
    notes: '',
    valid_from: toLocalInput(now),
    valid_until: toLocalInput(new Date(now.getTime() + 4 * 3600_000)),
  };
};

/**
 * Visitors expected at the gate. A camera read of the plate inside the window
 * shows the guard "Expected visitor" instead of an unregistered plate; the
 * guard still decides.
 */
const VisitorPasses: React.FC = () => {
  const [passes, setPasses] = useState<VisitorPass[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/visitor-passes');
      setPasses(asArray<VisitorPass>(data));
    } catch (err) {
      toast({ title: 'Could not load visitors', description: apiMessage(err, ''), status: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/visitor-passes', {
        plate_number: form.plate_number,
        visitor_name: form.visitor_name,
        notes: form.notes || null,
        valid_from: new Date(form.valid_from).toISOString(),
        valid_until: new Date(form.valid_until).toISOString(),
      });
      toast({ title: `${form.visitor_name} added`, status: 'success' });
      setForm(emptyForm());
      load();
    } catch (err) {
      toast({ title: 'Visitor not added', description: apiMessage(err, 'Check the details'), status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (pass: VisitorPass) => {
    try {
      await api.post(`/visitor-passes/${pass.id}/revoke`);
      setPasses((prev) => prev.filter((p) => p.id !== pass.id));
    } catch (err) {
      toast({ title: 'Could not cancel', description: apiMessage(err, ''), status: 'error' });
    }
  };

  const set = (key: keyof ReturnType<typeof emptyForm>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Card mt={8}>
      <CardHeader>
        <Heading size="md">
          <HStack spacing={2}>
            <Icon as={FiUserPlus} />
            <Text>My visitors</Text>
          </HStack>
        </Heading>
      </CardHeader>
      <CardBody>
        <Box as="form" onSubmit={submit} mb={6}>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
            <FormControl isRequired>
              <FormLabel>Visitor's plate</FormLabel>
              <Input value={form.plate_number} onChange={set('plate_number')} placeholder="e.g. ABC 1234" />
            </FormControl>
            <FormControl isRequired>
              <FormLabel>Visitor's name</FormLabel>
              <Input value={form.visitor_name} onChange={set('visitor_name')} maxLength={200} />
            </FormControl>
            <FormControl isRequired>
              <FormLabel>From</FormLabel>
              <Input type="datetime-local" value={form.valid_from} onChange={set('valid_from')} />
            </FormControl>
            <FormControl isRequired>
              <FormLabel>Until</FormLabel>
              <Input type="datetime-local" value={form.valid_until} onChange={set('valid_until')} />
            </FormControl>
            <FormControl>
              <FormLabel>Notes for the guard</FormLabel>
              <Input value={form.notes} onChange={set('notes')} maxLength={500} placeholder="Optional" />
            </FormControl>
          </SimpleGrid>
          <Button type="submit" colorScheme="blue" mt={4} isLoading={saving}>
            Add visitor
          </Button>
        </Box>

        {passes.length === 0 ? (
          <Text color="text.muted">No visitors expected.</Text>
        ) : (
          <VStack align="stretch" spacing={3}>
            {passes.map((p) => (
              <HStack key={p.id} justify="space-between" p={3} borderWidth="1px" borderRadius="md" wrap="wrap">
                <Box>
                  <HStack>
                    <Text fontWeight="bold" fontFamily="mono">{p.plate_display}</Text>
                    <Badge colorScheme="blue">{p.visitor_name}</Badge>
                  </HStack>
                  <Text fontSize="sm" color="text.muted">
                    {new Date(p.valid_from).toLocaleString()} – {new Date(p.valid_until).toLocaleString()}
                    {p.notes ? ` · ${p.notes}` : ''}
                  </Text>
                </Box>
                <Button size="sm" variant="outline" colorScheme="red" onClick={() => revoke(p)}>
                  Cancel
                </Button>
              </HStack>
            ))}
          </VStack>
        )}
      </CardBody>
    </Card>
  );
};

export default VisitorPasses;
