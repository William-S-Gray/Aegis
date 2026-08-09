import React, { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Heading,
  Input,
  Progress,
  Spinner,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react';
import { FiCheckCircle, FiRefreshCw } from 'react-icons/fi';
import api from '../api';
import { apiMessage, asArray } from '../utils/safe';

type ReviewReason = 'low_plate_confidence' | 'low_type_confidence' | 'ambiguous_plate';

interface ReviewAlert {
  id: string;
  plate_number: string;
  detected_type?: string | null;
  detected_color?: string | null;
  registered_type?: string | null;
  registered_color?: string | null;
  plate_confidence?: number | null;
  type_confidence?: number | null;
  mismatch_type: string;
  review_reason?: ReviewReason | null;
  detector_name?: string | null;
  detector_version?: string | null;
  timestamp: string;
}

const REASON_LABEL: Record<string, string> = {
  low_plate_confidence: 'Plate read was uncertain',
  low_type_confidence: 'Vehicle type was uncertain',
  ambiguous_plate: 'Plate was ambiguous',
};

const toPercent = (value?: number | null) =>
  typeof value === 'number' ? Math.round(value * 100) : null;

const confidenceScheme = (value?: number | null) => {
  const pct = toPercent(value);
  if (pct === null) return 'gray';
  return pct > 80 ? 'green' : pct > 60 ? 'yellow' : 'red';
};

const ReviewQueue: React.FC = () => {
  const [alerts, setAlerts] = useState<ReviewAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Keyed by alert id so editing one row never touches another.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<ReviewAlert[]>('/alerts/review-queue');
      const queue = asArray<ReviewAlert>(data);
      setAlerts(queue);
      // Pre-fill each box with the machine's reading: most reads are correct,
      // so confirming should be one click rather than full re-entry.
      setDrafts(Object.fromEntries(queue.map((a) => [a.id, a.plate_number])));
    } catch (err) {
      setAlerts([]);
      setError(apiMessage(err, 'Could not load the review queue'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirm = async (alert: ReviewAlert) => {
    const plate = (drafts[alert.id] ?? '').trim();
    if (!plate) {
      toast({ title: 'Enter the plate you can read', status: 'warning' });
      return;
    }

    setSaving((prev) => ({ ...prev, [alert.id]: true }));
    try {
      const { data } = await api.post<ReviewAlert>(`/alerts/${alert.id}/confirm-plate`, {
        plate_number: plate,
      });
      // The server re-classifies against the register, so report what it
      // decided rather than assuming the correction resolved the alert.
      const corrected = data.plate_number !== alert.plate_number;
      toast({
        title: corrected ? `Corrected to ${data.plate_number}` : 'Reading confirmed',
        description:
          data.mismatch_type === 'none'
            ? 'Matches the registered vehicle.'
            : `Still flagged: ${data.mismatch_type.replace('_', ' ')}.`,
        status: data.mismatch_type === 'none' ? 'success' : 'warning',
      });
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    } catch (err) {
      toast({
        title: 'Could not save',
        description: apiMessage(err, 'The confirmation was not recorded'),
        status: 'error',
      });
    } finally {
      setSaving((prev) => ({ ...prev, [alert.id]: false }));
    }
  };

  if (loading) {
    return (
      <Center minH="60vh">
        <Spinner size="lg" color="brand.500" thickness="3px" />
      </Center>
    );
  }

  return (
    <Box p={6} maxW="5xl" mx="auto">
      <Flex justify="space-between" align="center" mb={2} wrap="wrap" gap={3}>
        <Heading size="lg">Plate Review</Heading>
        <Button leftIcon={<FiRefreshCw />} size="sm" onClick={load}>
          Refresh
        </Button>
      </Flex>

      <Text color="gray.600" mb={6}>
        Reads the detector was not confident enough to act on alone. Confirm or correct
        each plate; the system re-checks it against the vehicle register.
      </Text>

      {error && (
        <Box mb={4} p={3} bg="red.50" borderRadius="md" border="1px solid" borderColor="red.200">
          <Text color="red.700" fontSize="sm">
            {error}
          </Text>
        </Box>
      )}

      {!error && alerts.length === 0 && (
        <Box
          p={10}
          bg="white"
          borderRadius="xl"
          border="1px solid"
          borderColor="gray.200"
          textAlign="center"
        >
          <Center mb={3}>
            <FiCheckCircle size={32} color="#22c55e" />
          </Center>
          <Heading size="sm" mb={1}>
            Nothing waiting
          </Heading>
          <Text color="gray.600" fontSize="sm">
            Every detection has been confirmed.
          </Text>
        </Box>
      )}

      <VStack align="stretch" spacing={4}>
        {alerts.map((alert) => (
          <Box
            key={alert.id}
            bg="white"
            p={5}
            borderRadius="xl"
            border="1px solid"
            borderColor="gray.200"
            boxShadow="6px 6px 12px #d1d5db, -6px -6px 12px #ffffff"
          >
            <Flex justify="space-between" align="flex-start" wrap="wrap" gap={3} mb={3}>
              <Box>
                <HStack spacing={3} mb={1}>
                  <Text fontSize="xl" fontWeight="bold" letterSpacing="wide">
                    {alert.plate_number}
                  </Text>
                  <Badge colorScheme="orange">
                    {REASON_LABEL[alert.review_reason ?? ''] ?? 'Needs review'}
                  </Badge>
                </HStack>
                <Text fontSize="sm" color="gray.500">
                  {new Date(alert.timestamp).toLocaleString()}
                  {alert.detector_name
                    ? ` · ${alert.detector_name} ${alert.detector_version ?? ''}`
                    : ''}
                </Text>
              </Box>

              <Box minW="180px">
                <Text fontSize="xs" color="gray.600" mb={1}>
                  Plate confidence: {toPercent(alert.plate_confidence) ?? '—'}%
                </Text>
                <Progress
                  value={toPercent(alert.plate_confidence) ?? 0}
                  colorScheme={confidenceScheme(alert.plate_confidence)}
                  size="sm"
                  borderRadius="full"
                />
              </Box>
            </Flex>

            <HStack spacing={8} mb={4} fontSize="sm" wrap="wrap">
              <Box>
                <Text color="gray.500">Detected</Text>
                <Text>
                  {[alert.detected_color, alert.detected_type].filter(Boolean).join(' ') || '—'}
                </Text>
              </Box>
              <Box>
                <Text color="gray.500">Registered</Text>
                <Text>
                  {[alert.registered_color, alert.registered_type].filter(Boolean).join(' ') ||
                    'Not registered'}
                </Text>
              </Box>
            </HStack>

            <Flex gap={3} align="center" wrap="wrap">
              <Input
                value={drafts[alert.id] ?? ''}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [alert.id]: e.target.value.toUpperCase() }))
                }
                placeholder="Plate as you read it"
                maxW="260px"
                fontFamily="mono"
                letterSpacing="wide"
              />
              <Button
                colorScheme="blue"
                leftIcon={<FiCheckCircle />}
                isLoading={saving[alert.id]}
                loadingText="Saving"
                onClick={() => confirm(alert)}
              >
                Confirm
              </Button>
              {(drafts[alert.id] ?? '') !== alert.plate_number && (
                <Text fontSize="xs" color="orange.600">
                  This will be recorded as a correction.
                </Text>
              )}
            </Flex>
          </Box>
        ))}
      </VStack>
    </Box>
  );
};

export default ReviewQueue;
