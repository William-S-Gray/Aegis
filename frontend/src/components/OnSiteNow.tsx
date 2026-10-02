import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Card, CardBody, CardHeader, Heading, HStack, Text, VStack } from '@chakra-ui/react';
import api from '../api';
import { asArray } from '../utils/safe';

interface Visit {
  id: string;
  plate_number: string;
  entered_at: string;
  visitor_pass?: { visitor_name: string; host_name?: string | null; valid_until: string } | null;
}

const REFRESH_MS = 30_000;

const duration = (from: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - new Date(from).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

/**
 * Vehicles that entered and have not left, from cameras tagged entry/exit.
 * A visitor still on site after their pass ended is flagged.
 */
const OnSiteNow: React.FC = () => {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setVisits(asArray<Visit>((await api.get('/visits/on-site')).data));
    } catch {
      // Keep the last list; the next refresh retries.
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <Card>
      <CardHeader pb={2}>
        <HStack justify="space-between">
          <Heading size="md">On site now</Heading>
          <Badge fontSize="md" colorScheme="blue">{visits.length}</Badge>
        </HStack>
      </CardHeader>
      <CardBody pt={2}>
        {visits.length === 0 ? (
          <Text color="gray.500" fontSize="sm">
            No vehicles on site (needs cameras tagged entry and exit).
          </Text>
        ) : (
          <VStack align="stretch" spacing={2}>
            {visits.map((v) => {
              const overdue = v.visitor_pass && new Date(v.visitor_pass.valid_until).getTime() < now;
              return (
                <HStack key={v.id} justify="space-between" wrap="wrap">
                  <HStack>
                    <Text fontFamily="mono" fontWeight="bold">{v.plate_number}</Text>
                    {v.visitor_pass && <Badge colorScheme={overdue ? 'red' : 'blue'}>{v.visitor_pass.visitor_name}</Badge>}
                    {overdue && <Badge colorScheme="red" variant="solid">Pass ended</Badge>}
                  </HStack>
                  <Text fontSize="sm" color="gray.600">{duration(v.entered_at, now)}</Text>
                </HStack>
              );
            })}
          </VStack>
        )}
      </CardBody>
    </Card>
  );
};

export default OnSiteNow;
