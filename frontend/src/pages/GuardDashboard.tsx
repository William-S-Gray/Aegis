import React, { useEffect, useState, useRef } from 'react';
import {
  Box, Heading, VStack, useToast, Button, Text, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Badge, HStack, 
  Grid, Stat, StatLabel, StatNumber, StatHelpText, StatArrow, Card, CardBody, CardHeader, Flex, Spacer,
  Progress, SimpleGrid, Icon, useColorModeValue,
  FormControl, FormLabel, Input, Select, Textarea, Switch, Slider, SliderTrack, SliderFilledTrack, SliderThumb, FormHelperText
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import { cameraStreamUrl, guardAlertsSocketUrl } from '../config';
import db from '../db';
import api from '../api';
import { apiMessage } from '../utils/safe';
import { startOfflineSync } from '../services/OfflineSyncService';
import { 
  FiActivity, FiAlertTriangle, FiCheckCircle, FiXCircle, FiClock, 
  FiCamera, FiShield, FiFileText, FiRefreshCw, FiSettings, 
  FiEye, FiUnlock, FiWifi
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

interface Analytics {
  totalAlerts: number;
  approvedCount: number;
  deniedCount: number;
  todayAlerts: number;
  weeklyTrend: number;
  averageResponseTime: number;
}

const GuardDashboard: React.FC = () => {
  const { user } = useAuth();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [analytics, setAnalytics] = useState<Analytics>({
    totalAlerts: 0,
    approvedCount: 0,
    deniedCount: 0,
    todayAlerts: 0,
    weeklyTrend: 0,
    averageResponseTime: 0
  });
  const wsRef = useRef<WebSocket | null>(null);
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Quick Actions Modals
  const { isOpen: isManualScanOpen, onOpen: onManualScanOpen, onClose: onManualScanClose } = useDisclosure();
  const { isOpen: isEmergencyOpen, onOpen: onEmergencyOpen, onClose: onEmergencyClose } = useDisclosure();
  const { isOpen: isReportOpen, onOpen: onReportOpen, onClose: onReportClose } = useDisclosure();
  const { isOpen: isSettingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();
  const { isOpen: isOverrideOpen, onOpen: onOverrideOpen, onClose: onOverrideClose } = useDisclosure();

  // Quick Actions State
  const [manualScanData, setManualScanData] = useState({
    plateNumber: '',
    location: 'Main Gate',
    notes: ''
  });

  const [emergencyData, setEmergencyData] = useState({
    type: 'lockdown',
    duration: 30,
    reason: '',
    affectedAreas: ['Main Gate', 'Side Entrance']
  });

  const [reportData, setReportData] = useState({
    type: 'shift',
    startTime: '',
    endTime: '',
    incidents: '',
    notes: ''
  });

  const [guardSettings, setGuardSettings] = useState({
    alertVolume: 75,
    autoApprove: false,
    emergencyContacts: ['911', 'Supervisor'],
    cameraSensitivity: 80,
    notificationSound: true
  });

  const [overrideData, setOverrideData] = useState({
    plateNumber: '',
    action: 'approve',
    reason: '',
    authorization: ''
  });

  // Live Feed State
  const [liveFeeds, setLiveFeeds] = useState([
    {
      id: 1,
      name: 'Phone Camera (Main Gate)',
      url: cameraStreamUrl('video_feed'),
      status: 'active',
      lastDetection: null as string | null,
      detectionCount: 0
    },
    {
      id: 2,
      name: 'Side Entrance Camera',
      url: cameraStreamUrl('stream/side-entrance'),
      status: 'inactive',
      lastDetection: null as string | null,
      detectionCount: 0
    },
    {
      id: 3,
      name: 'Back Gate Camera',
      url: cameraStreamUrl('stream/back-gate'),
      status: 'inactive',
      lastDetection: null as string | null,
      detectionCount: 0
    }
  ]);

  const [selectedFeed, setSelectedFeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Responsive design
  const bgColor = useColorModeValue('white', 'gray.800');
  // Hoisted out of the alert list: hooks cannot be called inside a .map callback.
  const alertItemBg = useColorModeValue('gray.50', 'gray.700');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  const updateAnalytics = (newAlert: Alert) => {
    setAnalytics(prev => ({
      totalAlerts: prev.totalAlerts + 1,
      approvedCount: prev.approvedCount + (newAlert.mismatch_type === 'none' ? 1 : 0),
      deniedCount: prev.deniedCount + (newAlert.mismatch_type !== 'none' ? 1 : 0),
      todayAlerts: prev.todayAlerts + 1,
      weeklyTrend: prev.weeklyTrend + 1,
      averageResponseTime: Math.round((prev.averageResponseTime + 2.5) / 2) // Mock calculation
    }));

    // Update live feed detection count
    setLiveFeeds(prev => prev.map(feed => ({
      ...feed,
      detectionCount: feed.detectionCount + 1,
      lastDetection: new Date().toISOString()
    })));
  };

  /*
   * Socket handlers live in a ref that is refreshed on every render, so the
   * effect below depends only on the guard id and the connection is not torn
   * down whenever an unrelated piece of state changes.
   */
  const handlersRef = useRef({ onOpenAlert: onOpen, notify: toast, onAlert: updateAnalytics });
  handlersRef.current = { onOpenAlert: onOpen, notify: toast, onAlert: updateAnalytics };

  const guardId = user?.id;

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
        setAlert(incoming);
        setRecentAlerts((prev) => [incoming, ...prev.slice(0, 9)]);
        handlersRef.current.onOpenAlert();
        audioRef.current?.play().catch(() => {
          // Autoplay stays blocked until the user interacts with the page.
        });
        handlersRef.current.onAlert(incoming);
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
    return startOfflineSync();
  }, [guardId]);

  const handleAction = async (action: string) => {
    if (!alert) return;
    const log = {
      plate_number: alert.plate_number,
      action,
      timestamp: new Date().toISOString(),
      details: alert,
    };
    try {
      await api.post('/access-logs', log);
      toast({ title: `Action ${action} sent`, status: 'success' });
      onClose();
    } catch (err) {
      await db.access_logs_queue.add(log);
      toast({ title: `Offline: ${action} queued`, status: 'warning' });
      onClose();
    }
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

  const handleEmergencyAction = async () => {
    try {
      // Mock emergency action - in real app, this would trigger emergency protocols
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      toast({ 
        title: 'Emergency Protocol Activated', 
        description: `${emergencyData.type} initiated for ${emergencyData.duration} minutes`,
        status: 'warning',
        duration: 5000
      });
      
      // Update analytics
      setAnalytics(prev => ({
        ...prev,
        totalAlerts: prev.totalAlerts + 1
      }));
      
      onEmergencyClose();
      setEmergencyData({
        type: 'lockdown',
        duration: 30,
        reason: '',
        affectedAreas: ['Main Gate', 'Side Entrance']
      });
    } catch (error) {
      toast({ 
        title: 'Emergency Action Failed', 
        description: 'Unable to activate emergency protocol',
        status: 'error' 
      });
    }
  };

  const handleReportGeneration = async () => {
    try {
      // Mock report generation - in real app, this would create a shift report
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      toast({ 
        title: 'Report Generated', 
        description: `${reportData.type} report has been created and saved`,
        status: 'success' 
      });
      
      onReportClose();
      setReportData({
        type: 'shift',
        startTime: '',
        endTime: '',
        incidents: '',
        notes: ''
      });
    } catch (error) {
      toast({ 
        title: 'Report Generation Failed', 
        description: 'Unable to generate report',
        status: 'error' 
      });
    }
  };

  const handleSettingsSave = () => {
    // Mock settings save - in real app, this would update guard preferences
    toast({ 
      title: 'Settings Updated', 
      description: 'Your preferences have been saved successfully',
      status: 'success' 
    });
    onSettingsClose();
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

  // Live Feed Handlers
  const handleFeedToggle = (feedId: number) => {
    setLiveFeeds(prev => prev.map(feed => 
      feed.id === feedId 
        ? { ...feed, status: feed.status === 'active' ? 'inactive' : 'active' }
        : feed
    ));
    
    const feed = liveFeeds.find(f => f.id === feedId);
    toast({
      title: `Camera ${feed?.status === 'active' ? 'Deactivated' : 'Activated'}`,
      description: `${feed?.name} has been ${feed?.status === 'active' ? 'deactivated' : 'activated'}`,
      status: feed?.status === 'active' ? 'warning' : 'success'
    });
  };

  const handleFeedSelect = (feedId: number) => {
    setSelectedFeed(feedId);
  };

  const handleFullscreenToggle = () => {
    setIsFullscreen(!isFullscreen);
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

      {/* Analytics Cards */}
      <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={6} mb={8}>
        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">Total Alerts</StatLabel>
              <StatNumber fontSize="2xl">{analytics.totalAlerts}</StatNumber>
              <StatHelpText>
                <StatArrow type="increase" />
                {analytics.weeklyTrend}% this week
              </StatHelpText>
            </Stat>
          </CardBody>
        </Card>

        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">Today's Alerts</StatLabel>
              <StatNumber fontSize="2xl" color="blue.500">{analytics.todayAlerts}</StatNumber>
              <StatHelpText>
                <Icon as={FiClock} mr={1} />
                Last 24 hours
              </StatHelpText>
            </Stat>
          </CardBody>
        </Card>

        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">Approved</StatLabel>
              <StatNumber fontSize="2xl" color="green.500">{analytics.approvedCount}</StatNumber>
              <StatHelpText>
                <Icon as={FiCheckCircle} mr={1} />
                {analytics.totalAlerts > 0 ? Math.round((analytics.approvedCount / analytics.totalAlerts) * 100) : 0}% rate
              </StatHelpText>
            </Stat>
          </CardBody>
        </Card>

        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">Denied</StatLabel>
              <StatNumber fontSize="2xl" color="red.500">{analytics.deniedCount}</StatNumber>
              <StatHelpText>
                <Icon as={FiXCircle} mr={1} />
                {analytics.totalAlerts > 0 ? Math.round((analytics.deniedCount / analytics.totalAlerts) * 100) : 0}% rate
              </StatHelpText>
            </Stat>
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Live Feed Section */}
      <Card bg={bgColor} border="1px" borderColor={borderColor} mb={8}>
        <CardHeader>
          <Flex justify="space-between" align="center">
            <Heading size="md">Live Camera Feeds</Heading>
            <HStack spacing={2}>
              <Button
                variant="neumorphic"
                size="sm"
                leftIcon={<FiEye />}
                onClick={handleFullscreenToggle}
                _hover={{
                  bg: 'blue.50',
                  color: 'blue.600',
                  boxShadow: '4px 4px 8px #bfdbfe, -4px -4px 8px #ffffff',
                }}
              >
                {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              </Button>
              <Button
                variant="neumorphic"
                size="sm"
                leftIcon={<FiRefreshCw />}
                onClick={() => {
                  toast({ 
                    title: 'Feeds Refreshed', 
                    description: 'All camera feeds have been refreshed',
                    status: 'success' 
                  });
                }}
                _hover={{
                  bg: 'green.50',
                  color: 'green.600',
                  boxShadow: '4px 4px 8px #bbf7d0, -4px -4px 8px #ffffff',
                }}
              >
                Refresh
              </Button>
            </HStack>
          </Flex>
        </CardHeader>
        <CardBody>
          <Grid templateColumns={{ base: '1fr', lg: '3fr 1fr' }} gap={6}>
            {/* Main Video Feed */}
            <Box>
              <Box
                position="relative"
                bg="gray.900"
                borderRadius="xl"
                overflow="hidden"
                boxShadow="inset 4px 4px 8px #1a202c, inset -4px -4px 8px #2d3748"
                border="1px solid"
                borderColor="gray.700"
                minH="400px"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                {/* Real Video Stream Component */}
                {liveFeeds.find(f => f.id === selectedFeed)?.status === 'active' && (
                  <Box
                    position="absolute"
                    top={0}
                    left={0}
                    right={0}
                    bottom={0}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    {/* Real video stream from phone camera */}
                    <Box
                      position="relative"
                      w="full"
                      h="full"
                      borderRadius="md"
                      overflow="hidden"
                    >
                      <img
                        src={cameraStreamUrl('video_feed')}
                        alt="Live Camera Feed"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                          const fallback = document.getElementById('camera-fallback');
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                      <VStack
                        id="camera-fallback"
                        spacing={4}
                        color="gray.400"
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'white', display: 'none', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Icon as={FiCamera} w={16} h={16} />
                        <Text fontSize="lg" fontWeight="bold">Phone Camera Feed</Text>
                        <Text fontSize="sm" textAlign="center">
                          Loading camera stream...<br />
                          Make sure IP Camera Lite is running
                        </Text>
                        <HStack spacing={4} mt={4}>
                          <Badge colorScheme="blue" variant="subtle">
                            <HStack spacing={1}>
                              <Icon as={FiWifi} w={3} h={3} />
                              <Text>CONNECTING</Text>
                            </HStack>
                          </Badge>
                        </HStack>
                      </VStack>
                    </Box>
                  </Box>
                )}

                {/* Fallback when camera is inactive */}
                {liveFeeds.find(f => f.id === selectedFeed)?.status === 'inactive' && (
                  <VStack spacing={4} color="gray.400">
                    <Icon as={FiCamera} w={16} h={16} />
                    <Text fontSize="lg" fontWeight="bold">
                      {liveFeeds.find(f => f.id === selectedFeed)?.name}
                    </Text>
                    <Text fontSize="sm" textAlign="center">
                      Camera Inactive<br />
                      Click "Activate" to start detection
                    </Text>
                    <Badge colorScheme="red" variant="subtle">
                      <HStack spacing={1}>
                        <Box w={2} h={2} bg="red.500" borderRadius="full" />
                        <Text>OFFLINE</Text>
                      </HStack>
                    </Badge>
                  </VStack>
                )}
              </Box>
            </Box>

            {/* Camera Controls */}
            <VStack spacing={4} align="stretch">
              <Text fontWeight="bold" color="gray.700">Camera Feeds</Text>
              {liveFeeds.map((feed) => (
                <Box
                  key={feed.id}
                  p={4}
                  border="1px"
                  borderColor={borderColor}
                  borderRadius="lg"
                  bg={selectedFeed === feed.id ? 'blue.50' : bgColor}
                  cursor="pointer"
                  onClick={() => handleFeedSelect(feed.id)}
                  _hover={{
                    bg: selectedFeed === feed.id ? 'blue.100' : 'gray.50',
                    boxShadow: '2px 2px 4px #d1d5db, -2px -2px 4px #ffffff',
                  }}
                >
                  <Flex justify="space-between" align="center" mb={2}>
                    <Text fontWeight="semibold" fontSize="sm">{feed.name}</Text>
                    <Badge 
                      colorScheme={feed.status === 'active' ? 'green' : 'red'} 
                      variant="subtle"
                      size="sm"
                    >
                      {feed.status}
                    </Badge>
                  </Flex>
                  
                  <HStack justify="space-between" mb={2}>
                    <Text fontSize="xs" color="gray.600">Detections</Text>
                    <Text fontSize="xs" fontWeight="bold">{feed.detectionCount}</Text>
                  </HStack>
                  
                  <HStack justify="space-between">
                    <Text fontSize="xs" color="gray.600">Last Seen</Text>
                    <Text fontSize="xs">
                      {feed.lastDetection 
                        ? new Date(feed.lastDetection).toLocaleTimeString()
                        : 'Never'
                      }
                    </Text>
                  </HStack>
                  
                  <Button
                    size="xs"
                    variant="neumorphic"
                    colorScheme={feed.status === 'active' ? 'red' : 'green'}
                    mt={2}
                    w="full"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFeedToggle(feed.id);
                    }}
                    _hover={{
                      bg: feed.status === 'active' ? 'red.50' : 'green.50',
                      color: feed.status === 'active' ? 'red.600' : 'green.600',
                      boxShadow: feed.status === 'active' 
                        ? '4px 4px 8px #fecaca, -4px -4px 8px #ffffff'
                        : '4px 4px 8px #bbf7d0, -4px -4px 8px #ffffff',
                    }}
                  >
                    {feed.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                </Box>
              ))}
            </VStack>
          </Grid>
        </CardBody>
      </Card>

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
                {recentAlerts.map((alert, index) => (
                  <Box 
                    key={index} 
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
                <HStack justify="space-between">
                  <Text fontSize="sm">Response Time</Text>
                  <Text fontSize="sm" fontWeight="bold">{analytics.averageResponseTime}s</Text>
                </HStack>
                <HStack justify="space-between">
                  <Text fontSize="sm">Active Sessions</Text>
                  <Text fontSize="sm" fontWeight="bold">1</Text>
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
                  leftIcon={<FiShield />}
                  colorScheme="red" 
                  size="sm" 
                  w="full"
                  onClick={onEmergencyOpen}
                  _hover={{
                    bg: 'red.50',
                    color: 'red.600',
                    boxShadow: '4px 4px 8px #fecaca, -4px -4px 8px #ffffff',
                  }}
                >
                  Emergency Protocol
                </Button>
                <Button 
                  variant="neumorphic"
                  leftIcon={<FiFileText />}
                  colorScheme="purple" 
                  size="sm" 
                  w="full"
                  onClick={onReportOpen}
                  _hover={{
                    bg: 'purple.50',
                    color: 'purple.600',
                    boxShadow: '4px 4px 8px #e9d5ff, -4px -4px 8px #ffffff',
                  }}
                >
                  Generate Report
                </Button>
                <Button 
                  variant="neumorphic"
                  leftIcon={<FiSettings />}
                  colorScheme="gray" 
                  size="sm" 
                  w="full"
                  onClick={onSettingsOpen}
                  _hover={{
                    bg: 'gray.50',
                    color: 'gray.600',
                    boxShadow: '4px 4px 8px #d1d5db, -4px -4px 8px #ffffff',
                  }}
                >
                  Guard Settings
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
                <Button 
                  variant="neumorphic"
                  leftIcon={<FiRefreshCw />}
                  colorScheme="green" 
                  size="sm" 
                  w="full"
                  onClick={() => {
                    toast({ 
                      title: 'System Refreshed', 
                      description: 'All systems have been refreshed',
                      status: 'success' 
                    });
                  }}
                  _hover={{
                    bg: 'green.50',
                    color: 'green.600',
                    boxShadow: '4px 4px 8px #bbf7d0, -4px -4px 8px #ffffff',
                  }}
                >
                  Refresh Systems
                </Button>
              </VStack>
            </CardBody>
          </Card>
        </VStack>
      </Grid>

      {/* Alert Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>New Alert - {alert?.plate_number}</ModalHeader>
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
            <Button variant="ghost" onClick={onClose}>
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

      {/* Emergency Protocol Modal */}
      <Modal isOpen={isEmergencyOpen} onClose={onEmergencyClose} size="lg">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">Emergency Protocol Activation</ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel color="gray.700">Emergency Type</FormLabel>
                <Select
                  value={emergencyData.type}
                  onChange={(e) => setEmergencyData(prev => ({ ...prev, type: e.target.value }))}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'red.400',
                  }}
                >
                  <option value="lockdown">Lockdown</option>
                  <option value="evacuation">Evacuation</option>
                  <option value="medical">Medical Emergency</option>
                  <option value="fire">Fire Emergency</option>
                  <option value="security">Security Breach</option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Duration (minutes)</FormLabel>
                <HStack spacing={4}>
                  <Slider
                    value={emergencyData.duration}
                    onChange={(value) => setEmergencyData(prev => ({ ...prev, duration: value }))}
                    min={5}
                    max={120}
                    step={5}
                    colorScheme="red"
                  >
                    <SliderTrack>
                      <SliderFilledTrack />
                    </SliderTrack>
                    <SliderThumb />
                  </Slider>
                  <Text fontWeight="bold" minW="3rem">{emergencyData.duration}m</Text>
                </HStack>
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Reason</FormLabel>
                <Textarea
                  value={emergencyData.reason}
                  onChange={(e) => setEmergencyData(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="Describe the emergency situation..."
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'red.400',
                  }}
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onEmergencyClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="red"
                onClick={handleEmergencyAction}
                _hover={{
                  bg: 'red.50',
                  color: 'red.600',
                  boxShadow: '6px 6px 12px #fecaca, -6px -6px 12px #ffffff',
                }}
              >
                Activate Emergency Protocol
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Report Generation Modal */}
      <Modal isOpen={isReportOpen} onClose={onReportClose} size="lg">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">Generate Shift Report</ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl>
                <FormLabel color="gray.700">Report Type</FormLabel>
                <Select
                  value={reportData.type}
                  onChange={(e) => setReportData(prev => ({ ...prev, type: e.target.value }))}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'purple.400',
                  }}
                >
                  <option value="shift">Shift Report</option>
                  <option value="incident">Incident Report</option>
                  <option value="daily">Daily Summary</option>
                  <option value="weekly">Weekly Summary</option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Start Time</FormLabel>
                <Input
                  type="datetime-local"
                  value={reportData.startTime}
                  onChange={(e) => setReportData(prev => ({ ...prev, startTime: e.target.value }))}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'purple.400',
                  }}
                />
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">End Time</FormLabel>
                <Input
                  type="datetime-local"
                  value={reportData.endTime}
                  onChange={(e) => setReportData(prev => ({ ...prev, endTime: e.target.value }))}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'purple.400',
                  }}
                />
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Incidents</FormLabel>
                <Textarea
                  value={reportData.incidents}
                  onChange={(e) => setReportData(prev => ({ ...prev, incidents: e.target.value }))}
                  placeholder="Describe any incidents that occurred..."
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'purple.400',
                  }}
                />
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Additional Notes</FormLabel>
                <Textarea
                  value={reportData.notes}
                  onChange={(e) => setReportData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Any additional notes or observations..."
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'purple.400',
                  }}
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onReportClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="purple"
                onClick={handleReportGeneration}
                _hover={{
                  bg: 'purple.50',
                  color: 'purple.600',
                  boxShadow: '6px 6px 12px #e9d5ff, -6px -6px 12px #ffffff',
                }}
              >
                Generate Report
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Guard Settings Modal */}
      <Modal isOpen={isSettingsOpen} onClose={onSettingsClose} size="lg">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">Guard Settings</ModalHeader>
          <ModalBody>
            <VStack spacing={6}>
              <FormControl>
                <FormLabel color="gray.700">Alert Volume</FormLabel>
                <HStack spacing={4}>
                  <Slider
                    value={guardSettings.alertVolume}
                    onChange={(value) => setGuardSettings(prev => ({ ...prev, alertVolume: value }))}
                    min={0}
                    max={100}
                    step={5}
                    colorScheme="brand"
                  >
                    <SliderTrack>
                      <SliderFilledTrack />
                    </SliderTrack>
                    <SliderThumb />
                  </Slider>
                  <Text fontWeight="bold" minW="3rem">{guardSettings.alertVolume}%</Text>
                </HStack>
                <FormHelperText>Adjust alert notification volume</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel color="gray.700">Camera Sensitivity</FormLabel>
                <HStack spacing={4}>
                  <Slider
                    value={guardSettings.cameraSensitivity}
                    onChange={(value) => setGuardSettings(prev => ({ ...prev, cameraSensitivity: value }))}
                    min={0}
                    max={100}
                    step={5}
                    colorScheme="blue"
                  >
                    <SliderTrack>
                      <SliderFilledTrack />
                    </SliderTrack>
                    <SliderThumb />
                  </Slider>
                  <Text fontWeight="bold" minW="3rem">{guardSettings.cameraSensitivity}%</Text>
                </HStack>
                <FormHelperText>Adjust camera detection sensitivity</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel color="gray.700">Auto-Approve Known Vehicles</FormLabel>
                <Switch
                  isChecked={guardSettings.autoApprove}
                  onChange={(e) => setGuardSettings(prev => ({ ...prev, autoApprove: e.target.checked }))}
                  colorScheme="green"
                />
                <FormHelperText>Automatically approve vehicles in the system</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel color="gray.700">Notification Sound</FormLabel>
                <Switch
                  isChecked={guardSettings.notificationSound}
                  onChange={(e) => setGuardSettings(prev => ({ ...prev, notificationSound: e.target.checked }))}
                  colorScheme="blue"
                />
                <FormHelperText>Play sound for new alerts</FormHelperText>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onSettingsClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="brand"
                onClick={handleSettingsSave}
                _hover={{
                  bg: 'brand.50',
                  color: 'brand.600',
                  boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
                }}
              >
                Save Settings
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