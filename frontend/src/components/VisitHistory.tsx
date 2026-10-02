import React, { useEffect, useState } from 'react';
import { Box, HStack, Select, Stat, StatLabel, StatNumber, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react';
import api from '../api';
import { asArray, asNumber } from '../utils/safe';

interface Visit {
  id: string;
  plate_number: string;
  entered_at?: string | null;
  exited_at?: string | null;
  visitor_pass?: { visitor_name: string } | null;
}

const fmt = (t?: string | null) => (t ? new Date(t).toLocaleString() : '—');
const minutesBetween = (a?: string | null, b?: string | null) =>
  a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000) : null;

/** Recent visits and how long vehicles stay, from entry/exit cameras. */
const VisitHistory: React.FC = () => {
  const [days, setDays] = useState(7);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [median, setMedian] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/visits', { params: { days } })
      .then(({ data }) => {
        if (cancelled) return;
        setVisits(asArray<Visit>(data?.visits));
        setMedian(data?.median_minutes == null ? null : asNumber(data.median_minutes));
      })
      .catch(() => !cancelled && setVisits([]));
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <Box>
      <HStack spacing={8} mb={4} align="end" wrap="wrap">
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} maxW="180px" aria-label="Period">
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </Select>
        <Stat><StatLabel>Visits</StatLabel><StatNumber>{visits.length}</StatNumber></Stat>
        <Stat><StatLabel>Median stay</StatLabel><StatNumber>{median == null ? '—' : `${median} min`}</StatNumber></Stat>
      </HStack>
      {visits.length === 0 ? (
        <Text color="gray.500">No visits in this period (needs cameras tagged entry and exit).</Text>
      ) : (
        <Table size="sm">
          <Thead><Tr><Th>Plate</Th><Th>In</Th><Th>Out</Th><Th isNumeric>Minutes</Th></Tr></Thead>
          <Tbody>
            {visits.map((v) => (
              <Tr key={v.id}>
                <Td fontFamily="mono">
                  {v.plate_number}
                  {v.visitor_pass ? ` · ${v.visitor_pass.visitor_name}` : ''}
                </Td>
                <Td>{v.entered_at ? fmt(v.entered_at) : 'not seen'}</Td>
                <Td>{v.exited_at ? fmt(v.exited_at) : 'on site'}</Td>
                <Td isNumeric>{minutesBetween(v.entered_at, v.exited_at) ?? '—'}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Box>
  );
};

export default VisitHistory;
