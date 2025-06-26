import React, { useEffect, useState, useRef } from 'react';
import {
  Box, Heading, VStack, useToast, Button, Text, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Badge, HStack, Divider, Tag,
  Grid, GridItem, Stat, StatLabel, StatNumber, StatHelpText, StatArrow, Card, CardBody, CardHeader, Flex, Spacer, useBreakpointValue,
  Table, Thead, Tbody, Tr, Th, Td, Progress, SimpleGrid, Icon, useColorModeValue, useDisclosure as useChakraDisclosure,
  FormControl, FormLabel, Input, Select, Textarea, Switch, Slider, SliderTrack, SliderFilledTrack, SliderThumb, FormHelperText
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
// @ts-ignore
import db from '../db';
// @ts-ignore
import api from '../api';
// @ts-ignore
import { startOfflineSync } from '../services/OfflineSyncService';
import { 
  FiActivity, FiAlertTriangle, FiCheckCircle, FiXCircle, FiTrendingUp, FiUsers, FiClock, 
  FiCamera, FiShield, FiFileText, FiRefreshCw, FiSettings, FiBell, FiMapPin, FiUser, FiTruck,
  FiDownload, FiEye, FiLock, FiUnlock, FiRadio, FiWifi, FiBattery, FiThermometer
} from 'react-icons/fi';

const WS_URL = (guardId: string) => `ws://localhost:8000/ws/guard-alerts/${guardId}`;

interface Alert {
  plate: string;
  status: string;
  owner?: string;
  vehicle_info?: any;
  timestamp: string;
  confidence_score?: number;
  warning_level?: string;
  warning_message?: string;
}

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
      url: 'http://172.16.3.100:8081/video',
      status: 'active',
      lastDetection: null as string | null,
      detectionCount: 0
    },
    {
      id: 2,
      name: 'Side Entrance Camera',
      url: 'http://localhost:8001/stream/side-entrance',
      status: 'inactive',
      lastDetection: null as string | null,
      detectionCount: 0
    },
    {
      id: 3,
      name: 'Back Gate Camera',
      url: 'http://localhost:8001/stream/back-gate',
      status: 'inactive',
      lastDetection: null as string | null,
      detectionCount: 0
    }
  ]);

  const [selectedFeed, setSelectedFeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Responsive design
  const isMobile = useBreakpointValue({ base: true, md: false });
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  useEffect(() => {
    if (!user?.id) return;
    wsRef.current = new WebSocket(WS_URL(user.id.toString()));
    wsRef.current.onopen = () => setWsStatus('connected');
    wsRef.current.onclose = () => setWsStatus('disconnected');
    wsRef.current.onmessage = (event) => {
      try {
        // Try to parse as JSON first
        const data = JSON.parse(event.data);
        setAlert(data);
        setRecentAlerts((prev) => [data, ...prev.slice(0, 9)]);
        onOpen();
        if (audioRef.current) audioRef.current.play();
        
        // Update analytics
        updateAnalytics(data);
      } catch (error) {
        // If it's not JSON, it might be a welcome message or other text
        console.log('Received non-JSON message:', event.data);
        // Don't treat welcome messages as alerts
        if (!event.data.includes('Welcome')) {
          // Handle other non-JSON messages if needed
        }
      }
    };
    wsRef.current.onerror = () => {
      setWsStatus('error');
      toast({ title: 'WebSocket error', status: 'error' });
    };
    return () => { wsRef.current && wsRef.current.close(); };
  }, [user]);

  const updateAnalytics = (newAlert: Alert) => {
    setAnalytics(prev => ({
      totalAlerts: prev.totalAlerts + 1,
      approvedCount: prev.approvedCount + (newAlert.status === 'APPROVED' ? 1 : 0),
      deniedCount: prev.deniedCount + (newAlert.status === 'DENIED' ? 1 : 0),
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

  const handleAction = async (action: string) => {
    if (!alert) return;
    const log = {
      plate_number: alert.plate,
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED': return 'green';
      case 'DENIED': return 'red';
      default: return 'yellow';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED': return FiCheckCircle;
      case 'DENIED': return FiXCircle;
      default: return FiAlertTriangle;
    }
  };

  // Quick Actions Handlers
  const handleManualScan = async () => {
    try {
      // Mock API call - in real app, this would trigger a manual scan
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const scanResult = {
        plate: manualScanData.plateNumber,
        status: 'PENDING',
        timestamp: new Date().toISOString(),
        location: manualScanData.location,
        notes: manualScanData.notes
      };
      
      setRecentAlerts(prev => [scanResult, ...prev.slice(0, 9)]);
      toast({ 
        title: 'Manual Scan Initiated', 
        description: `Scanning plate ${manualScanData.plateNumber} at ${manualScanData.location}`,
        status: 'success' 
      });
      onManualScanClose();
      setManualScanData({ plateNumber: '', location: 'Main Gate', notes: '' });
    } catch (error) {
      toast({ 
        title: 'Scan Failed', 
        description: 'Unable to initiate manual scan',
        status: 'error' 
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
    try {
      // Mock override action - in real app, this would override system decision
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const overrideResult = {
        plate: overrideData.plateNumber,
        status: overrideData.action.toUpperCase(),
        timestamp: new Date().toISOString(),
        reason: overrideData.reason,
        authorizedBy: user?.email || 'Unknown'
      };
      
      setRecentAlerts(prev => [overrideResult, ...prev.slice(0, 9)]);
      toast({ 
        title: 'Override Action Applied', 
        description: `Vehicle ${overrideData.plateNumber} has been ${overrideData.action}d`,
        status: 'success' 
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
        title: 'Override Failed', 
        description: 'Unable to apply override action',
        status: 'error' 
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
                      w="full"
                      h="full"
                      bg="gray.800"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      position="relative"
                      overflow="hidden"
                      borderRadius="md"
                    >
                      {/* Actual video element for phone camera */}
                      {selectedFeed === 1 && (
                        <Box
                          as="img"
                          src="http://172.16.3.100:8081/video"
                          alt="Live Camera Feed"
                          w="full"
                          h="full"
                          objectFit="cover"
                          fallback={
                            <VStack spacing={4} color="gray.400">
                              <Icon as={FiCamera} w={16} h={16} />
                              <Text fontSize="lg" fontWeight="bold">
                                Phone Camera Feed
                              </Text>
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
                          }
                        />
                      )}
                      
                      {/* Simulated video for other cameras */}
                      {selectedFeed !== 1 && (
                        <Box
                          w="80%"
                          h="60%"
                          bg="gray.700"
                          borderRadius="md"
                          position="relative"
                          overflow="hidden"
                        >
                          {/* Simulated license plate detection box */}
                          <Box
                            position="absolute"
                            top="40%"
                            left="30%"
                            w="40%"
                            h="20%"
                            border="2px solid"
                            borderColor="red.400"
                            borderRadius="sm"
                            bg="rgba(239, 68, 68, 0.1)"
                          >
                            <Text
                              position="absolute"
                              top="-25px"
                              left="0"
                              color="red.400"
                              fontSize="xs"
                              fontWeight="bold"
                            >
                              ABC123
                            </Text>
                          </Box>
                          
                          {/* Detection confidence indicator */}
                          <Box
                            position="absolute"
                            bottom="10px"
                            right="10px"
                            bg="rgba(0, 0, 0, 0.8)"
                            color="white"
                            px={2}
                            py={1}
                            borderRadius="sm"
                            fontSize="xs"
                          >
                            Confidence: 87%
                          </Box>
                        </Box>
                      )}
                      
                      {/* Connection status overlay */}
                      <Box
                        position="absolute"
                        top="10px"
                        left="10px"
                        bg="rgba(0, 0, 0, 0.8)"
                        color="green.400"
                        px={2}
                        py={1}
                        borderRadius="sm"
                        fontSize="xs"
                      >
                        <HStack spacing={1}>
                          <Box w={2} h={2} bg="green.400" borderRadius="full" />
                          <Text>LIVE</Text>
                        </HStack>
                      </Box>

                      {/* Last Detection Overlay */}
                      <Box
                        position="absolute"
                        top="10px"
                        right="10px"
                        bg="rgba(0, 0, 0, 0.8)"
                        color="white"
                        px={3}
                        py={2}
                        borderRadius="md"
                        fontSize="sm"
                      >
                        <Text fontWeight="bold">Last Detection</Text>
                        <Text>
                          {liveFeeds.find(f => f.id === selectedFeed)?.lastDetection 
                            ? new Date(liveFeeds.find(f => f.id === selectedFeed)!.lastDetection!).toLocaleTimeString()
                            : 'None'
                          }
                        </Text>
                      </Box>
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
                    bg={useColorModeValue('gray.50', 'gray.700')}
                  >
                    <Flex justify="space-between" align="center" mb={2}>
                      <HStack spacing={3}>
                        <Icon 
                          as={getStatusIcon(alert.status)} 
                          color={`${getStatusColor(alert.status)}.500`} 
                          w={5} 
                          h={5} 
                        />
                        <Text fontWeight="bold" fontSize="lg">{alert.plate}</Text>
                        <Badge colorScheme={getStatusColor(alert.status)} variant="subtle">
                          {alert.status}
                        </Badge>
                      </HStack>
                      <Text fontSize="sm" color="gray.500">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </Text>
                    </Flex>
                    
                    {alert.owner && (
                      <Text fontSize="sm" color="gray.600" mb={1}>
                        Owner: {alert.owner}
                      </Text>
                    )}
                    
                    {alert.vehicle_info && (
                      <Text fontSize="sm" color="gray.600" mb={1}>
                        Vehicle: {alert.vehicle_info.make} {alert.vehicle_info.model} ({alert.vehicle_info.color})
                      </Text>
                    )}
                    
                    {alert.confidence_score && (
                      <Box>
                        <Text fontSize="sm" color="gray.600" mb={1}>Confidence: {alert.confidence_score}%</Text>
                        <Progress 
                          value={alert.confidence_score} 
                          colorScheme={alert.confidence_score > 80 ? 'green' : alert.confidence_score > 60 ? 'yellow' : 'red'}
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
          <ModalHeader>New Alert - {alert?.plate}</ModalHeader>
          <ModalBody>
            {alert && (
              <VStack spacing={4} align="stretch">
                <HStack justify="space-between">
                  <Text fontWeight="bold">Status:</Text>
                  <Badge colorScheme={getStatusColor(alert.status)} size="lg">
                    {alert.status}
                  </Badge>
                </HStack>
                
                {alert.owner && (
                  <HStack justify="space-between">
                    <Text fontWeight="bold">Owner:</Text>
                    <Text>{alert.owner}</Text>
                  </HStack>
                )}
                
                {alert.vehicle_info && (
                  <HStack justify="space-between">
                    <Text fontWeight="bold">Vehicle:</Text>
                    <Text>{alert.vehicle_info.make} {alert.vehicle_info.model}</Text>
                  </HStack>
                )}
                
                {alert.confidence_score && (
                  <HStack justify="space-between">
                    <Text fontWeight="bold">Confidence:</Text>
                    <Text>{alert.confidence_score}%</Text>
                  </HStack>
                )}
                
                {alert.warning_message && (
                  <Box p={3} bg="red.50" border="1px" borderColor="red.200" borderRadius="md">
                    <Text color="red.800" fontSize="sm">{alert.warning_message}</Text>
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