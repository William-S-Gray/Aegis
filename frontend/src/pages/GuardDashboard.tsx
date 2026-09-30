import React, { useEffect, useState, useRef } from 'react';
import {
  Box, Heading, VStack, useToast, Button, Text, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Badge, HStack,
  Grid, Card, CardBody, CardHeader, Flex, Spacer,
  Progress, Icon, useColorModeValue,
  FormControl, FormLabel, Input, Select, Textarea
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import { guardAlertsSocketUrl } from '../config';
import CameraPanel from '../components/CameraPanel';
import db, { newClientRef } from '../db';
import api from '../api';
import { apiMessage, asArray } from '../utils/safe';
import { startOfflineSync } from '../services/OfflineSyncService';
import {
  FiActivity, FiAlertTriangle, FiCheckCircle, FiXCircle,
  FiCamera, FiUnlock
} from 'react-icons/fi';

// Endpoints come from src/config.ts so deployments are environment-driven
// and https origins automatically upgrade to wss.

/** Mirrors AlertPublic from the API. */
interface Alert {
  id: string;
  plate_number: string;
  detected_type?: string | null;
  detected_color?: string | null;
  registered_type?: string | null;
  registered_color?: string | null;
  plate_confidence?: number | null;
  type_confidence?: number | null;
  mismatch_type: 'none' | 'type' | 'color' | 'unregistered';
  status: 'open' | 'in_progress' | 'closed';
  feedback_status: string;
  timestamp: string;
}

// The API reports confidence as 0-1; the UI shows whole percentages.
const toPercent = (value: number) => Math.round(value * 100);
const confidenceScheme = (value: number) =>
  value > 0.8 ? 'green' : value > 0.6 ? 'yellow' : 'red';

// Why the alert fired is the signal a guard acts on, so it drives the styling.
const MISMATCH_LABEL: Record<string, string> = {
  none: 'Matches register',
  type: 'Vehicle type mismatch',
  color: 'Colour mismatch',
  unregistered: 'Unregistered plate',
};

const RECENT_LIMIT = 10;

const GuardDashboard: React.FC = () => {
  const { user } = useAuth();
  // Alerts awaiting a decision, oldest first. The modal always shows the head,
  // so a new arrival can never replace the plate a guard is deciding on.
  const [pending, setPending] = useState<Alert[]>([]);
  const alert = pending[0] ?? null;
  const dismissCurrent = () => setPending((prev) => prev.slice(1));
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Quick Actions Modals
  const { isOpen: isManualScanOpen, onOpen: onManualScanOpen, onClose: onManualScanClose } = useDisclosure();
  const { isOpen: isOverrideOpen, onOpen: onOverrideOpen, onClose: onOverrideClose } = useDisclosure();

  // Quick Actions State
  const [manualScanData, setManualScanData] = useState({
    plateNumber: '',
    location: 'Main Gate',
    notes: ''
  });


  const [overrideData, setOverrideData] = useState({
    plateNumber: '',
    action: 'approve',
    reason: '',
    authorization: ''
  });


  // Responsive design
  const bgColor = useColorModeValue('white', 'gray.800');
  // Hoisted out of the alert list: hooks cannot be called inside a .map callback.
  const alertItemBg = useColorModeValue('gray.50', 'gray.700');
  const borderColor = useColorModeValue('gray.200', 'gray.700');



  const guardId = user?.id;

  // Seed Recent Alerts from the API, so a guard who signs in or refreshes sees
  // what already happened instead of an empty board. Only the list: the
  // decision queue stays live-only, for vehicles actually at the gate now.
  useEffect(() => {
    if (!guardId) return;
    let cancelled = false;
    api
      .get('/alerts', { params: { limit: RECENT_LIMIT } })
      .then(({ data }) => {
        if (cancelled) return;
        const loaded = asArray<Alert>(data?.alerts);
        // Live arrivals may have landed first; keep them on top, once each.
        setRecentAlerts((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...loaded.filter((a) => !seen.has(a.id))].slice(0, RECENT_LIMIT);
        });
      })
      .catch(() => {
        // The live feed still works; the list just starts empty.
      });
    return () => {
      cancelled = true;
    };
  }, [guardId]);

  useEffect(() => {
    if (!guardId) {
      setWsStatus('disconnected');
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    // Exponential backoff, capped, so a backend outage does not turn every
    // guard console into a reconnect storm against a recovering server.
    const retryDelay = () => Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;

    const connect = async () => {
      if (cancelled) return;
      setWsStatus('connecting');

      let ticket: string;
      try {
        // Exchange the bearer token for a single-use ticket over HTTPS; the
        // token itself must never appear in a WebSocket URL.
        const { data } = await api.post<{ ticket: string }>('/auth/ws-ticket');
        ticket = data.ticket;
      } catch {
        if (cancelled) return;
        setWsStatus('error');
        attempt += 1;
        retryTimer = setTimeout(connect, retryDelay());
        return;
      }

      if (cancelled) return;

      socket = new WebSocket(guardAlertsSocketUrl(guardId, ticket));
      wsRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setWsStatus('connected');
      };

      socket.onclose = () => {
        if (cancelled) return;
        setWsStatus('disconnected');
        attempt += 1;
        retryTimer = setTimeout(connect, retryDelay());
      };

      // `onclose` always follows `onerror`, so reconnection is handled there.
      socket.onerror = () => setWsStatus('error');

      socket.onmessage = (event) => {
        let message: { type?: string; alert?: Alert };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === 'ping' || message.type === 'connected') return;
        if (message.type !== 'alert' || !message.alert) return;

        const incoming = message.alert;
        setPending((prev) => [...prev, incoming]);
        setRecentAlerts((prev) =>
          [incoming, ...prev.filter((a) => a.id !== incoming.id)].slice(0, RECENT_LIMIT)
        );
        audioRef.current?.play().catch(() => {
          // Autoplay stays blocked until the user interacts with the page.
        });
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      // Close cleanly so the handler above does not schedule a reconnect.
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [guardId]);

  // Flush any access logs queued while offline, and stop the timer on unmount.
  useEffect(() => {
    if (!guardId) return;
    return startOfflineSync(guardId);
  }, [guardId]);

  const handleAction = async (action: 'approve' | 'deny') => {
    // Bound to the head of the queue at click time: an alert arriving while
    // the guard reads cannot change which vehicle this decision is about.
    const current = pending[0];
    if (!current || !user) return;
    const log = {
      client_ref: newClientRef(),
      plate_number: current.plate_number,
      action,
      timestamp: new Date().toISOString(),
      details: { alert_id: current.id },
    };
    try {
      await api.post('/access-logs', log);
      toast({ title: `Action ${action} sent`, status: 'success' });
    } catch (err) {
      if ((err as { response?: unknown }).response) {
        // The server answered and refused. That is not an offline case, and
        // queueing it would only fail again later, out of the guard's sight.
        toast({
          title: 'Decision not recorded',
          description: apiMessage(err, 'The server rejected it'),
          status: 'error',
        });
        return;
      }
      await db.access_logs_queue.add({ ...log, user_id: user.id });
      toast({ title: `Offline: ${action} queued`, status: 'warning' });
    }
    dismissCurrent();
  };

  const getStatusColor = (mismatch: string) => {
    switch (mismatch) {
      case 'none': return 'green';
      case 'unregistered': return 'red';
      default: return 'orange';
    }
  };

  const getStatusIcon = (mismatch: string) => {
    switch (mismatch) {
      case 'none': return FiCheckCircle;
      case 'unregistered': return FiXCircle;
      default: return FiAlertTriangle;
    }
  };

  // Quick Actions Handlers
  const handleManualScan = async () => {
    if (!manualScanData.plateNumber.trim()) {
      toast({ title: 'Enter a plate number', status: 'warning' });
      return;
    }
    try {
      // Raises a real alert. The server classifies it against the register and
      // broadcasts it back over the socket, which is what updates the list —
      // so there is deliberately no local insert here.
      const { data } = await api.post<Alert>('/alerts', {
        plate_number: manualScanData.plateNumber,
      });

      toast({
        title: 'Alert raised',
        description: `${data.plate_number}: ${MISMATCH_LABEL[data.mismatch_type] ?? data.mismatch_type}`,
        status: data.mismatch_type === 'none' ? 'success' : 'warning',
      });
      onManualScanClose();
      setManualScanData({ plateNumber: '', location: 'Main Gate', notes: '' });
    } catch (error) {
      toast({
        title: 'Scan failed',
        description: apiMessage(error, 'Unable to raise an alert'),
        status: 'error',
      });
    }
  };


  const handleOverrideAction = async () => {
    if (!overrideData.plateNumber.trim() || !overrideData.reason.trim()) {
      toast({ title: 'Plate number and reason are required', status: 'warning' });
      return;
    }
    try {
      // An override is a recorded access decision, not a UI-only action: it is
      // written to the access log with its justification so it can be audited.
      await api.post('/access-logs', {
        plate_number: overrideData.plateNumber,
        action: 'override',
        details: {
          decision: overrideData.action,
          reason: overrideData.reason,
          authorization: overrideData.authorization,
        },
      });

      toast({
        title: 'Override recorded',
        description: `${overrideData.plateNumber} — ${overrideData.action}`,
        status: 'success',
      });
      
      onOverrideClose();
      setOverrideData({
        plateNumber: '',
        action: 'approve',
        reason: '',
        authorization: ''
      });
    } catch (error) {
      toast({
        title: 'Override failed',
        description: apiMessage(error, 'Unable to record the override'),
        status: 'error',
      });
    }
  };

  return (
    <Box p={{ base: 4, md: 8 }} bg="gray.50" minH="100vh">
      {/* Header */}
      <Flex direction={{ base: 'column', md: 'row' }} mb={6} align={{ base: 'start', md: 'center' }}>
        <Heading size="lg" mb={{ base: 4, md: 0 }}>Guard Dashboard</Heading>
        <Spacer />
        <HStack spacing={4}>
          <Badge 
            colorScheme={wsStatus === 'connected' ? 'green' : 'red'} 
            variant="subtle" 
            px={3} 
            py={1} 
            borderRadius="full"
          >
            <HStack spacing={2}>
              <Box w={2} h={2} bg={wsStatus === 'connected' ? 'green.500' : 'red.500'} borderRadius="full" />
              <Text fontSize="sm" textTransform="capitalize">{wsStatus}</Text>
            </HStack>
          </Badge>
        </HStack>
      </Flex>


      <CameraPanel />

      {/* Main Content Grid */}
      <Grid templateColumns={{ base: '1fr', lg: '2fr 1fr' }} gap={6}>
        {/* Recent Alerts */}
        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardHeader>
            <Heading size="md">Recent Alerts</Heading>
          </CardHeader>
          <CardBody>
            {recentAlerts.length === 0 ? (
              <VStack spacing={4} py={8}>
                <Icon as={FiActivity} w={8} h={8} color="gray.400" />
                <Text color="gray.500">No alerts yet.</Text>
                <Text fontSize="sm" color="gray.400">Waiting for license plate alerts...</Text>
              </VStack>
            ) : (
              <VStack spacing={4} align="stretch">
                {recentAlerts.map((alert) => (
                  <Box 
                    key={alert.id} 
                    p={4} 
                    border="1px" 
                    borderColor={borderColor} 
                    borderRadius="md"
                    bg={alertItemBg}
                  >
                    <Flex justify="space-between" align="center" mb={2}>
                      <HStack spacing={3}>
                        <Icon 
                          as={getStatusIcon(alert.mismatch_type)} 
                          color={`${getStatusColor(alert.mismatch_type)}.500`} 
                          w={5} 
                          h={5} 
                        />
                        <Text fontWeight="bold" fontSize="lg">{alert.plate_number}</Text>
                        <Badge colorScheme={getStatusColor(alert.mismatch_type)} variant="subtle">
                          {MISMATCH_LABEL[alert.mismatch_type] ?? alert.mismatch_type}
                        </Badge>
                      </HStack>
                      <Text fontSize="sm" color="gray.500">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </Text>
                    </Flex>
                    
                    {(alert.detected_type || alert.detected_color) && (
                      <Text fontSize="sm" color="gray.600" mb={1}>
                        Detected: {[alert.detected_color, alert.detected_type].filter(Boolean).join(' ')}
                      </Text>
                    )}

                    {(alert.registered_type || alert.registered_color) && (
                      <Text fontSize="sm" color="gray.600" mb={1}>
                        Registered: {[alert.registered_color, alert.registered_type].filter(Boolean).join(' ')}
                      </Text>
                    )}

                    {typeof alert.plate_confidence === 'number' && (
                      <Box>
                        <Text fontSize="sm" color="gray.600" mb={1}>
                          Plate confidence: {toPercent(alert.plate_confidence)}%
                        </Text>
                        <Progress
                          value={toPercent(alert.plate_confidence)}
                          colorScheme={confidenceScheme(alert.plate_confidence)}
                          size="sm"
                        />
                      </Box>
                    )}
                  </Box>
                ))}
              </VStack>
            )}
          </CardBody>
        </Card>

        {/* Quick Actions & Status */}
        <VStack spacing={6} align="stretch">
          {/* Connection Status */}
          <Card bg={bgColor} border="1px" borderColor={borderColor}>
            <CardHeader>
              <Heading size="sm">System Status</Heading>
            </CardHeader>
            <CardBody>
              <VStack spacing={3} align="stretch">
                <HStack justify="space-between">
                  <Text fontSize="sm">WebSocket</Text>
                  <Badge colorScheme={wsStatus === 'connected' ? 'green' : 'red'}>
                    {wsStatus}
                  </Badge>
                </HStack>
              </VStack>
            </CardBody>
          </Card>

          {/* Quick Actions */}
          <Card bg={bgColor} border="1px" borderColor={borderColor}>
            <CardHeader>
              <Heading size="sm">Quick Actions</Heading>
            </CardHeader>
            <CardBody>
              <VStack spacing={3}>
                <Button 
                  variant="neumorphic"
                  leftIcon={<FiCamera />}
                  colorScheme="blue" 
                  size="sm" 
                  w="full"
                  onClick={onManualScanOpen}
                  _hover={{
                    bg: 'blue.50',
                    color: 'blue.600',
                    boxShadow: '4px 4px 8px #bfdbfe, -4px -4px 8px #ffffff',
                  }}
                >
                  Manual Scan
                </Button>
                <Button 
                  variant="neumorphic"
                  leftIcon={<FiUnlock />}
                  colorScheme="orange" 
                  size="sm" 
                  w="full"
                  onClick={onOverrideOpen}
                  _hover={{
                    bg: 'orange.50',
                    color: 'orange.600',
                    boxShadow: '4px 4px 8px #fed7aa, -4px -4px 8px #ffffff',
                  }}
                >
                  System Override
                </Button>
              </VStack>
            </CardBody>
          </Card>
        </VStack>
      </Grid>

      {/* Alert Modal */}
      <Modal isOpen={pending.length > 0} onClose={dismissCurrent} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            New Alert - {alert?.plate_number}
            {pending.length > 1 && (
              <Badge ml={3} colorScheme="orange">
                +{pending.length - 1} waiting
              </Badge>
            )}
          </ModalHeader>
          <ModalBody>
            {alert && (
              <VStack spacing={4} align="stretch">
                <HStack justify="space-between">
                  <Text fontWeight="bold">Status:</Text>
                  <Badge colorScheme={getStatusColor(alert.mismatch_type)} size="lg">
                    {MISMATCH_LABEL[alert.mismatch_type] ?? alert.mismatch_type}
                  </Badge>
                </HStack>
                
                <HStack justify="space-between">
                  <Text fontWeight="bold">Detected:</Text>
                  <Text>
                    {[alert.detected_color, alert.detected_type].filter(Boolean).join(' ') || '—'}
                  </Text>
                </HStack>

                <HStack justify="space-between">
                  <Text fontWeight="bold">Registered:</Text>
                  <Text>
                    {[alert.registered_color, alert.registered_type].filter(Boolean).join(' ') ||
                      'Not registered'}
                  </Text>
                </HStack>

                {typeof alert.plate_confidence === 'number' && (
                  <HStack justify="space-between">
                    <Text fontWeight="bold">Plate confidence:</Text>
                    <Text>{toPercent(alert.plate_confidence)}%</Text>
                  </HStack>
                )}

                {alert.mismatch_type !== 'none' && (
                  <Box p={3} bg="red.50" border="1px" borderColor="red.200" borderRadius="md">
                    <Text color="red.800" fontSize="sm">
                      {MISMATCH_LABEL[alert.mismatch_type] ?? alert.mismatch_type}
                      {alert.mismatch_type === 'unregistered'
                        ? ' — this plate is not in the register.'
                        : ' — detected attributes differ from the registered vehicle.'}
                    </Text>
                  </Box>
                )}
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="green" mr={3} onClick={() => handleAction('approve')}>
              Approve
            </Button>
            <Button colorScheme="red" mr={3} onClick={() => handleAction('deny')}>
              Deny
            </Button>
            <Button variant="ghost" onClick={dismissCurrent}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Audio element for alerts */}
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT" />

      {/* Manual Scan Modal */}
      <Modal isOpen={isManualScanOpen} onClose={onManualScanClose} size="md">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">Manual License Plate Scan</ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel color="gray.700">Plate Number</FormLabel>
                <Input
                  value={manualScanData.plateNumber}
                  onChange={(e) => setManualScanData(prev => ({ ...prev, plateNumber: e.target.value }))}
                  placeholder="Enter plate number"
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'blue.400',
                  }}
                />
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Location</FormLabel>
                <Select
                  value={manualScanData.location}
                  onChange={(e) => setManualScanData(prev => ({ ...prev, location: e.target.value }))}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'blue.400',
                  }}
                >
                  <option value="Main Gate">Main Gate</option>
                  <option value="Side Entrance">Side Entrance</option>
                  <option value="Back Gate">Back Gate</option>
                  <option value="Employee Entrance">Employee Entrance</option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Notes</FormLabel>
                <Textarea
                  value={manualScanData.notes}
                  onChange={(e) => setManualScanData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Additional notes..."
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'blue.400',
                  }}
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onManualScanClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="blue"
                onClick={handleManualScan}
                _hover={{
                  bg: 'blue.50',
                  color: 'blue.600',
                  boxShadow: '6px 6px 12px #bfdbfe, -6px -6px 12px #ffffff',
                }}
              >
                Initiate Scan
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* System Override Modal */}
      <Modal isOpen={isOverrideOpen} onClose={onOverrideClose} size="md">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">System Override</ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel color="gray.700">Plate Number</FormLabel>
                <Input
                  value={overrideData.plateNumber}
                  onChange={(e) => setOverrideData(prev => ({ ...prev, plateNumber: e.target.value }))}
                  placeholder="Enter plate number"
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'orange.400',
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Override Action</FormLabel>
                <Select
                  value={overrideData.action}
                  onChange={(e) => setOverrideData(prev => ({ ...prev, action: e.target.value }))}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'orange.400',
                  }}
                >
                  <option value="approve">Approve Access</option>
                  <option value="deny">Deny Access</option>
                  <option value="flag">Flag for Review</option>
                </Select>
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Reason for Override</FormLabel>
                <Textarea
                  value={overrideData.reason}
                  onChange={(e) => setOverrideData(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="Explain why you're overriding the system decision..."
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'orange.400',
                  }}
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onOverrideClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="orange"
                onClick={handleOverrideAction}
                _hover={{
                  bg: 'orange.50',
                  color: 'orange.600',
                  boxShadow: '6px 6px 12px #fed7aa, -6px -6px 12px #ffffff',
                }}
              >
                Apply Override
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default GuardDashboard; 