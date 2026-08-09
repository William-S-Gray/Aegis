import React, { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Box,
  Heading,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Button,
  useDisclosure,
  Input,
  FormLabel,
  Select,
  Spinner,
  useToast,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Flex,
  Spacer,
  Badge,
  HStack,
  VStack,
  Text,
  Icon,
  useColorModeValue,
  Progress,
  Grid,
  FormControl,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  FormHelperText,
  Switch
} from '@chakra-ui/react';
import {
  FiUsers,
  FiTruck,
  FiActivity,
  FiAlertTriangle,
  
  
  FiDownload,
  FiRefreshCw,
  FiTrendingUp,
  
  FiShield,
  FiClock,
  FiMapPin,
} from 'react-icons/fi';
import api from '../api';
import { mockAuthEnabled } from '../config';
import { asArray, apiMessage } from '../utils/safe';

interface User {
  id: string;
  full_name: string;
  email: string;
  password?: string;
  role: string;
  is_active: boolean;
}

interface Vehicle {
  id: string;
  plate_number: string;
  plate_display?: string;
  make: string;
  model: string;
  color: string;
  owner_id: string;
}

interface Log {
  id: string;
  plate_number: string;
  timestamp: string;
  action: string;
  user_id: string;
  vehicle_id: string;
}

interface ReportData {
  totalAccess?: number;
  authorizedAccess?: number;
  unauthorizedAccess?: number;
  alerts?: number;
  systemUptime?: number;
}

interface Analytics {
  totalUsers: number;
  totalVehicles: number;
  totalLogs: number;
  activeUsers: number;
  weeklyGrowth: number;
  monthlyAlerts: number;
}

/*
 * Sample rows used only when VITE_ENABLE_MOCK_AUTH is on, so the UI can be
 * developed before the backend exists. Never shown in staging or production.
 */
const SAMPLE_USERS: User[] = [
  { id: 'sample-1', full_name: 'Admin User', email: 'admin@example.com', role: 'admin', is_active: true },
  { id: 'sample-2', full_name: 'Guard User', email: 'guard@example.com', role: 'guard', is_active: true },
  { id: 'sample-3', full_name: 'Regular User', email: 'user@example.com', role: 'user', is_active: true },
];

const SAMPLE_VEHICLES: Vehicle[] = [
  { id: 'sample-v1', plate_number: 'ABC123', make: 'Toyota', model: 'Camry', color: 'White', owner_id: 'sample-3' },
  { id: 'sample-v2', plate_number: 'XYZ789', make: 'Honda', model: 'Civic', color: 'Blue', owner_id: 'sample-3' },
];

const SAMPLE_LOGS: Log[] = [
  { id: 'sample-l1', plate_number: 'ABC123', timestamp: new Date().toISOString(), action: 'Entry', user_id: 'sample-2', vehicle_id: 'sample-v1' },
  { id: 'sample-l2', plate_number: 'XYZ789', timestamp: new Date().toISOString(), action: 'Exit', user_id: 'sample-2', vehicle_id: 'sample-v2' },
];

const AdminDashboard: React.FC = () => {
  /*
   * Uptime and security score have no data source yet; they render as "—"
   * rather than as invented figures. Wire them to real health/scoring
   * endpoints when those exist.
   */
  const [stats] = useState<{ systemUptime: number | null; securityScore: number | null }>({
    systemUptime: null,
    securityScore: null
  });
  const [loadError, setLoadError] = useState('');

  const [recentAlerts] = useState([
    {
      id: 1,
      type: 'Unauthorized Access',
      vehicle: 'ABC-123',
      location: 'Main Gate',
      time: '2 minutes ago',
      status: 'Active',
      severity: 'High'
    },
    {
      id: 2,
      type: 'Vehicle Not Found',
      vehicle: 'XYZ-789',
      location: 'Side Entrance',
      time: '15 minutes ago',
      status: 'Resolved',
      severity: 'Medium'
    },
    {
      id: 3,
      type: 'System Alert',
      vehicle: 'N/A',
      location: 'Camera 3',
      time: '1 hour ago',
      status: 'Active',
      severity: 'Low'
    }
  ]);

  const [recentActivity] = useState([
    { id: 1, user: 'John Doe', action: 'Vehicle registered', time: '5 min ago', type: 'success' },
    { id: 2, user: 'Jane Smith', action: 'Access granted', time: '12 min ago', type: 'info' },
    { id: 3, user: 'Mike Johnson', action: 'User account created', time: '1 hour ago', type: 'success' },
    { id: 4, user: 'Sarah Wilson', action: 'Alert acknowledged', time: '2 hours ago', type: 'warning' }
  ]);

  // User Management
  const [users, setUsers] = useState<User[]>([]);
  const [userForm, setUserForm] = useState<Omit<User, 'id' | 'is_active'>>({ full_name: '', email: '', password: '', role: 'guard' });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Vehicle Management
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleForm, setVehicleForm] = useState<Omit<Vehicle, 'id'>>({ 
    plate_number: '', 
    make: '', 
    model: '', 
    color: '', 
    owner_id: '' 
  });
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const { isOpen: isVehicleOpen, onOpen: onVehicleOpen, onClose: onVehicleClose } = useDisclosure();
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  // Access Logs
  const [logs, setLogs] = useState<Log[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Analytics
  const [analytics, setAnalytics] = useState<Analytics>({
    totalUsers: 0,
    totalVehicles: 0,
    totalLogs: 0,
    activeUsers: 0,
    weeklyGrowth: 0,
    monthlyAlerts: 0
  });

  // Security Settings Modal
  const { isOpen: isSecurityOpen, onOpen: onSecurityOpen, onClose: onSecurityClose } = useDisclosure();
  const [securitySettings, setSecuritySettings] = useState({
    cameraSensitivity: 75,
    alertThreshold: 3,
    autoLock: true,
    emergencyMode: false,
    backupFrequency: 'daily'
  });

  // System Reports Modal
  const { isOpen: isReportsOpen, onOpen: onReportsOpen, onClose: onReportsClose } = useDisclosure();
  const [selectedReport, setSelectedReport] = useState('daily');
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  // Responsive design
  const cardBg = useColorModeValue('white', 'gray.700');

  // Fetch users
  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    api.get('/users')
      .then((res) => {
        if (cancelled) return;
        const userData = asArray<User>(res.data);
        setUsers(userData);
        setAnalytics(prev => ({
          ...prev,
          totalUsers: userData.length,
          activeUsers: userData.filter(u => u.is_active).length
        }));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error('Failed to fetch users:', err);
        // Seed the screen with sample rows in local dev only. In any real
        // environment an empty list is shown, so a backend outage is visible
        // rather than being papered over with fabricated numbers.
        const fallback = mockAuthEnabled ? SAMPLE_USERS : [];
        setUsers(fallback);
        setLoadError(mockAuthEnabled ? '' : 'Could not load data from the server.');
        setAnalytics(prev => ({
          ...prev,
          totalUsers: fallback.length,
          activeUsers: fallback.filter(u => u.is_active).length
        }));
      })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, []);

  // Fetch vehicles
  useEffect(() => {
    let cancelled = false;
    setLoadingVehicles(true);
    api.get('/vehicles')
      .then((res) => {
        if (cancelled) return;
        const vehicleData = asArray<Vehicle>(res.data);
        setVehicles(vehicleData);
        setAnalytics(prev => ({ ...prev, totalVehicles: vehicleData.length }));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error('Failed to fetch vehicles:', err);
        const fallback = mockAuthEnabled ? SAMPLE_VEHICLES : [];
        setVehicles(fallback);
        setAnalytics(prev => ({ ...prev, totalVehicles: fallback.length }));
      })
      .finally(() => { if (!cancelled) setLoadingVehicles(false); });
    return () => { cancelled = true; };
  }, []);

  // Fetch access logs
  useEffect(() => {
    let cancelled = false;
    setLoadingLogs(true);
    api.get('/logs')
      .then((res) => {
        if (cancelled) return;
        const logData = asArray<Log>(res.data);
        setLogs(logData);
        setAnalytics(prev => ({
          ...prev,
          totalLogs: logData.length,
          monthlyAlerts: logData.filter(log => {
            const logDate = new Date(log.timestamp);
            const now = new Date();
            return logDate.getMonth() === now.getMonth()
              && logDate.getFullYear() === now.getFullYear();
          }).length
        }));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error('Failed to fetch logs:', err);
        const fallback = mockAuthEnabled ? SAMPLE_LOGS : [];
        setLogs(fallback);
        setAnalytics(prev => ({
          ...prev,
          totalLogs: fallback.length,
          monthlyAlerts: fallback.length
        }));
      })
      .finally(() => { if (!cancelled) setLoadingLogs(false); });
    return () => { cancelled = true; };
  }, []);


  // User CRUD
  const handleUserFormChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setUserForm({ ...userForm, [e.target.name]: e.target.value });
  const openEditUser = (user: User) => { setEditingUser(user); const { id: _ignoredId, is_active: _ignoredActive, ...rest } = user; setUserForm({ ...rest, password: '' }); onOpen(); };
  const openCreateUser = () => { setEditingUser(null); setUserForm({ full_name: '', email: '', password: '', role: 'guard' }); onOpen(); };
  const handleUserSubmit = async () => {
    try {
      if (editingUser) {
        // Password changes are not part of this form; send only profile fields.
        const { password: _unused, ...profile } = userForm;
        const { data } = await api.patch<User>(`/users/${editingUser.id}`, profile);
        setUsers(prev => prev.map(u => (u.id === editingUser.id ? data : u)));
        toast({ title: 'User updated', status: 'success' });
      } else {
        const { data } = await api.post<User>('/users', userForm);
        setUsers(prev => [...prev, data]);
        toast({ title: 'User created', status: 'success' });
      }
      onClose();
    } catch (error) {
      toast({ title: 'Error', description: apiMessage(error, 'Failed to save user'), status: 'error' });
    }
  };
  const handleUserDeactivate = async (id: string) => {
    try {
      const { data } = await api.delete<User>(`/users/${id}`);
      setUsers(prev => prev.map(u => (u.id === id ? data : u)));
      toast({ title: 'User deactivated', status: 'success' });
    } catch (error) {
      toast({ title: 'Error', description: apiMessage(error, 'Failed to deactivate user'), status: 'error' });
    }
  };

  // Vehicle CRUD
  const handleVehicleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => setVehicleForm({ ...vehicleForm, [e.target.name]: e.target.value });
  const openEditVehicle = (v: Vehicle) => { setEditingVehicle(v); const { id: _ignoredId, ...rest } = v; setVehicleForm(rest); onVehicleOpen(); };
  const openCreateVehicle = () => { setEditingVehicle(null); setVehicleForm({ plate_number: '', make: '', model: '', color: '', owner_id: '' }); onVehicleOpen(); };
  
  const handleVehicleSubmit = async () => {
    try {
      if (editingVehicle) {
        // The plate itself is immutable: changing it would silently rewrite the
        // vehicle that historical access logs and alerts refer to.
        const { plate_number: _plate, ...editable } = vehicleForm;
        const { data } = await api.patch<Vehicle>(`/vehicles/${editingVehicle.id}`, editable);
        setVehicles(prev => prev.map(v => (v.id === editingVehicle.id ? data : v)));
        toast({ title: 'Vehicle updated', status: 'success' });
      } else {
        const payload = {
          ...vehicleForm,
          owner_id: vehicleForm.owner_id || null,
        };
        const { data } = await api.post<Vehicle>('/vehicles', payload);
        setVehicles(prev => [...prev, data]);
        toast({ title: 'Vehicle registered', status: 'success' });
      }
      onVehicleClose();
    } catch (error) {
      toast({ title: 'Error', description: apiMessage(error, 'Failed to save vehicle'), status: 'error' });
    }
  };

  const handleVehicleDelete = async (id: string) => {
    try {
      await api.delete(`/vehicles/${id}`);
      setVehicles(prev => prev.filter(v => v.id !== id));
      toast({ title: 'Vehicle deleted', status: 'success' });
    } catch (error) {
      toast({ title: 'Error', description: apiMessage(error, 'Failed to delete vehicle'), status: 'error' });
    }
  };

  // Security Settings Handlers
  const handleSecuritySettingChange = (setting: string, value: string | number | boolean) => {
    setSecuritySettings(prev => ({
      ...prev,
      [setting]: value
    }));
  };

  const handleSecuritySave = () => {
    // Mock save - in real app, this would be an API call
    toast({ 
      title: 'Security Settings Updated', 
      description: 'Your security settings have been saved successfully',
      status: 'success' 
    });
    onSecurityClose();
  };

  // System Reports Handlers
  const generateReport = async () => {
    setGeneratingReport(true);
    try {
      // Mock report generation - in real app, this would be an API call
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API delay
      
      const mockReportData = {
        daily: {
          totalAccess: 156,
          authorizedAccess: 142,
          unauthorizedAccess: 14,
          alerts: 8,
          systemUptime: 99.9
        },
        weekly: {
          totalAccess: 1089,
          authorizedAccess: 1023,
          unauthorizedAccess: 66,
          alerts: 45,
          systemUptime: 99.7
        },
        monthly: {
          totalAccess: 4567,
          authorizedAccess: 4321,
          unauthorizedAccess: 246,
          alerts: 189,
          systemUptime: 99.5
        }
      };
      
      setReportData(mockReportData[selectedReport as keyof typeof mockReportData]);
      toast({ 
        title: 'Report Generated', 
        description: `${selectedReport.charAt(0).toUpperCase() + selectedReport.slice(1)} report has been generated successfully`,
        status: 'success' 
      });
    } catch (error) {
      toast({ 
        title: 'Error', 
        description: 'Failed to generate report', 
        status: 'error' 
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const exportReport = () => {
    if (!reportData) {
      toast({ 
        title: 'No Report', 
        description: 'Please generate a report first', 
        status: 'warning' 
      });
      return;
    }
    
    // Mock export - in real app, this would download a file
    toast({ 
      title: 'Report Exported', 
      description: 'Report has been exported successfully',
      status: 'success' 
    });
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'purple';
      case 'guard': return 'blue';
      case 'user': return 'green';
      default: return 'gray';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'High': return 'red';
      case 'Medium': return 'orange';
      case 'Low': return 'yellow';
      default: return 'gray';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'red';
      case 'Resolved': return 'green';
      case 'Pending': return 'yellow';
      default: return 'gray';
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'success': return 'green';
      case 'warning': return 'orange';
      case 'error': return 'red';
      default: return 'blue';
    }
  };

  return (
    <Box p={{ base: 4, md: 8 }} bg="gray.100" minH="100vh">
      {/* Header */}
      <VStack spacing={6} align="stretch" mb={8}>
        <Box
          bg="white"
          p={6}
          borderRadius="2xl"
          boxShadow="8px 8px 16px #d1d5db, -8px -8px 16px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <HStack justify="space-between" align="center">
            <VStack align="start" spacing={2}>
              <Heading 
                size="lg"
                bgGradient="linear(to-r, brand.500, brand.600)"
                bgClip="text"
                fontWeight="bold"
              >
                Admin Dashboard
              </Heading>
              <Text color="gray.600">
                System overview and management controls
              </Text>
              {loadError && (
                <Text color="red.500" fontSize="sm" fontWeight="medium">
                  {loadError}
                </Text>
              )}
            </VStack>
            <HStack spacing={4}>
              <Button
                leftIcon={<FiRefreshCw />}
                variant="neumorphic"
                size="sm"
                onClick={() => window.location.reload()}
                _hover={{
                  bg: 'brand.50',
                  color: 'brand.600',
                  boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
                }}
              >
                Refresh
              </Button>
              <Button
                leftIcon={<FiDownload />}
                variant="neumorphic"
                size="sm"
                _hover={{
                  bg: 'brand.50',
                  color: 'brand.600',
                  boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
                }}
              >
                Export
              </Button>
            </HStack>
          </HStack>
        </Box>
      </VStack>

      {/* Stats Grid */}
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={6} mb={8}>
        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          boxShadow="6px 6px 12px #d1d5db, -6px -6px 12px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          _hover={{
            boxShadow: '8px 8px 16px #cbd5e1, -8px -8px 16px #ffffff',
            transform: 'translateY(-2px)',
            transition: 'all 0.3s ease',
          }}
        >
          <HStack spacing={4}>
            <Box
              w={12}
              h={12}
              borderRadius="xl"
              bg="brand.50"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="inset 4px 4px 8px #bae6fd, inset -4px -4px 8px #ffffff"
              border="1px solid"
              borderColor="brand.200"
            >
              <Icon as={FiUsers} w={6} h={6} color="brand.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {analytics.totalUsers}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">Total Users</StatLabel>
              </Stat>
            </VStack>
          </HStack>
        </Box>

        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          boxShadow="6px 6px 12px #d1d5db, -6px -6px 12px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          _hover={{
            boxShadow: '8px 8px 16px #cbd5e1, -8px -8px 16px #ffffff',
            transform: 'translateY(-2px)',
            transition: 'all 0.3s ease',
          }}
        >
          <HStack spacing={4}>
            <Box
              w={12}
              h={12}
              borderRadius="xl"
              bg="green.50"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="inset 4px 4px 8px #bbf7d0, inset -4px -4px 8px #ffffff"
              border="1px solid"
              borderColor="green.200"
            >
              <Icon as={FiTruck} w={6} h={6} color="green.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {analytics.totalVehicles}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">Registered Vehicles</StatLabel>
              </Stat>
            </VStack>
          </HStack>
        </Box>

        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          boxShadow="6px 6px 12px #d1d5db, -6px -6px 12px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          _hover={{
            boxShadow: '8px 8px 16px #cbd5e1, -8px -8px 16px #ffffff',
            transform: 'translateY(-2px)',
            transition: 'all 0.3s ease',
          }}
        >
          <HStack spacing={4}>
            <Box
              w={12}
              h={12}
              borderRadius="xl"
              bg="red.50"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="inset 4px 4px 8px #fecaca, inset -4px -4px 8px #ffffff"
              border="1px solid"
              borderColor="red.200"
            >
              <Icon as={FiAlertTriangle} w={6} h={6} color="red.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {analytics.monthlyAlerts}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">Active Alerts</StatLabel>
              </Stat>
            </VStack>
          </HStack>
        </Box>

        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          boxShadow="6px 6px 12px #d1d5db, -6px -6px 12px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          _hover={{
            boxShadow: '8px 8px 16px #cbd5e1, -8px -8px 16px #ffffff',
            transform: 'translateY(-2px)',
            transition: 'all 0.3s ease',
          }}
        >
          <HStack spacing={4}>
            <Box
              w={12}
              h={12}
              borderRadius="xl"
              bg="blue.50"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="inset 4px 4px 8px #dbeafe, inset -4px -4px 8px #ffffff"
              border="1px solid"
              borderColor="blue.200"
            >
              <Icon as={FiActivity} w={6} h={6} color="blue.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {stats.systemUptime === null ? '—' : `${stats.systemUptime}%`}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">System Uptime</StatLabel>
                <Progress value={stats.systemUptime ?? 0} size="sm" colorScheme="blue" borderRadius="full" />
              </Stat>
            </VStack>
          </HStack>
        </Box>

        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          boxShadow="6px 6px 12px #d1d5db, -6px -6px 12px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          _hover={{
            boxShadow: '8px 8px 16px #cbd5e1, -8px -8px 16px #ffffff',
            transform: 'translateY(-2px)',
            transition: 'all 0.3s ease',
          }}
        >
          <HStack spacing={4}>
            <Box
              w={12}
              h={12}
              borderRadius="xl"
              bg="purple.50"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="inset 4px 4px 8px #e9d5ff, inset -4px -4px 8px #ffffff"
              border="1px solid"
              borderColor="purple.200"
            >
              <Icon as={FiTrendingUp} w={6} h={6} color="purple.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {analytics.totalLogs}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">Recent Activities</StatLabel>
              </Stat>
            </VStack>
          </HStack>
        </Box>

        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          boxShadow="6px 6px 12px #d1d5db, -6px -6px 12px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          _hover={{
            boxShadow: '8px 8px 16px #cbd5e1, -8px -8px 16px #ffffff',
            transform: 'translateY(-2px)',
            transition: 'all 0.3s ease',
          }}
        >
          <HStack spacing={4}>
            <Box
              w={12}
              h={12}
              borderRadius="xl"
              bg="orange.50"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="inset 4px 4px 8px #fed7aa, inset -4px -4px 8px #ffffff"
              border="1px solid"
              borderColor="orange.200"
            >
              <Icon as={FiShield} w={6} h={6} color="orange.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {stats.securityScore ?? '—'}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">Security Score</StatLabel>
                <Progress value={stats.securityScore ?? 0} size="sm" colorScheme="orange" borderRadius="full" />
              </Stat>
            </VStack>
          </HStack>
        </Box>
      </SimpleGrid>

      {/* Alerts and Activity Section */}
      <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={8}>
        {/* Recent Alerts */}
        <Box
          bg={cardBg}
          borderRadius="xl"
          boxShadow="8px 8px 16px #d1d5db, -8px -8px 16px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          overflow="hidden"
        >
          <Box p={6} borderBottom="1px solid" borderColor="gray.200">
            <HStack justify="space-between">
              <Heading size="md" color="gray.700">Recent Alerts</Heading>
              <Button size="sm" variant="ghost" color="brand.500">
                View All
              </Button>
            </HStack>
          </Box>
          <Box p={6}>
            <VStack spacing={4} align="stretch">
              {recentAlerts.map((alert) => (
                <Box
                  key={alert.id}
                  p={4}
                  borderRadius="lg"
                  bg="gray.50"
                  border="1px solid"
                  borderColor="gray.200"
                  _hover={{
                    bg: 'gray.100',
                    transform: 'translateY(-1px)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <HStack justify="space-between" mb={2}>
                    <HStack spacing={2}>
                      <Icon as={FiAlertTriangle} color={getSeverityColor(alert.severity)} />
                      <Text fontWeight="semibold" color="gray.700">
                        {alert.type}
                      </Text>
                    </HStack>
                    <Badge colorScheme={getStatusColor(alert.status)} variant="subtle">
                      {alert.status}
                    </Badge>
                  </HStack>
                  <VStack align="start" spacing={1}>
                    <HStack spacing={4} fontSize="sm" color="gray.600">
                      <HStack spacing={1}>
                        <Icon as={FiTruck} />
                        <Text>{alert.vehicle}</Text>
                      </HStack>
                      <HStack spacing={1}>
                        <Icon as={FiMapPin} />
                        <Text>{alert.location}</Text>
                      </HStack>
                      <HStack spacing={1}>
                        <Icon as={FiClock} />
                        <Text>{alert.time}</Text>
                      </HStack>
                    </HStack>
                  </VStack>
                </Box>
              ))}
            </VStack>
          </Box>
        </Box>

        {/* Recent Activity */}
        <Box
          bg={cardBg}
          borderRadius="xl"
          boxShadow="8px 8px 16px #d1d5db, -8px -8px 16px #ffffff"
          border="1px solid"
          borderColor="gray.200"
          overflow="hidden"
        >
          <Box p={6} borderBottom="1px solid" borderColor="gray.200">
            <HStack justify="space-between">
              <Heading size="md" color="gray.700">Recent Activity</Heading>
              <Button size="sm" variant="ghost" color="brand.500">
                View All
              </Button>
            </HStack>
          </Box>
          <Box p={6}>
            <VStack spacing={4} align="stretch">
              {recentActivity.map((activity) => (
                <Box
                  key={activity.id}
                  p={4}
                  borderRadius="lg"
                  bg="gray.50"
                  border="1px solid"
                  borderColor="gray.200"
                  _hover={{
                    bg: 'gray.100',
                    transform: 'translateY(-1px)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <HStack justify="space-between">
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="semibold" color="gray.700">
                        {activity.user}
                      </Text>
                      <Text fontSize="sm" color="gray.600">
                        {activity.action}
                      </Text>
                    </VStack>
                    <VStack align="end" spacing={1}>
                      <Badge colorScheme={getActivityColor(activity.type)} variant="subtle">
                        {activity.type}
                      </Badge>
                      <Text fontSize="xs" color="gray.500">
                        {activity.time}
                      </Text>
                    </VStack>
                  </HStack>
                </Box>
              ))}
            </VStack>
          </Box>
        </Box>
      </Grid>

      {/* Quick Actions */}
      <Box
        mt={8}
        bg={cardBg}
        p={6}
        borderRadius="xl"
        boxShadow="8px 8px 16px #d1d5db, -8px -8px 16px #ffffff"
        border="1px solid"
        borderColor="gray.200"
      >
        <Heading size="md" mb={6} color="gray.700">Quick Actions</Heading>
        <HStack spacing={4} flexWrap="wrap">
          <Button
            variant="neumorphic"
            leftIcon={<FiUsers />}
            onClick={openCreateUser}
            _hover={{
              bg: 'brand.50',
              color: 'brand.600',
              boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
            }}
          >
            Add User
          </Button>
          <Button
            variant="neumorphic"
            leftIcon={<FiTruck />}
            onClick={openCreateVehicle}
            _hover={{
              bg: 'brand.50',
              color: 'brand.600',
              boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
            }}
          >
            Register Vehicle
          </Button>
          <Button
            variant="neumorphic"
            leftIcon={<FiShield />}
            onClick={onSecurityOpen}
            _hover={{
              bg: 'brand.50',
              color: 'brand.600',
              boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
            }}
          >
            Security Settings
          </Button>
          <Button
            variant="neumorphic"
            leftIcon={<FiActivity />}
            onClick={onReportsOpen}
            _hover={{
              bg: 'brand.50',
              color: 'brand.600',
              boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
            }}
          >
            System Reports
          </Button>
          <Button
            variant="neumorphic"
            leftIcon={<FiRefreshCw />}
            onClick={() => window.location.reload()}
            _hover={{
              bg: 'brand.50',
              color: 'brand.600',
              boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
            }}
          >
            Refresh Data
          </Button>
          <Button
            variant="neumorphic"
            leftIcon={<FiDownload />}
            onClick={() => toast({ 
              title: 'Export Started', 
              description: 'System data export has been initiated',
              status: 'success' 
            })}
            _hover={{
              bg: 'brand.50',
              color: 'brand.600',
              boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
            }}
          >
            Export Data
          </Button>
        </HStack>
      </Box>

      <Tabs variant="enclosed">
        <TabList>
          <Tab>Users</Tab>
          <Tab>Vehicles</Tab>
          <Tab>Access Logs</Tab>
        </TabList>
        <TabPanels>
          {/* Users Tab */}
          <TabPanel>
            <Flex direction={{ base: 'column', md: 'row' }} mb={4} gap={4}>
              <Button colorScheme="blue" onClick={openCreateUser}>Add User</Button>
              <Spacer />
              <Text fontSize="sm" color="gray.600">
                Showing {users.length} users ({users.filter(u => u.is_active).length} active)
              </Text>
            </Flex>
            
            {loadingUsers ? (
              <Flex justify="center" py={8}>
                <Spinner size="lg" />
              </Flex>
            ) : (
              <Box overflowX="auto">
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Email</Th>
                      <Th>Role</Th>
                      <Th>Status</Th>
                      <Th>Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {users.map(u => (
                      <Tr key={u.id}>
                        <Td fontWeight="medium">{u.full_name}</Td>
                        <Td>{u.email}</Td>
                        <Td>
                          <Badge colorScheme={getRoleColor(u.role)} variant="subtle">
                            {u.role}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge colorScheme={u.is_active ? 'green' : 'red'} variant="subtle">
                            {u.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </Td>
                        <Td>
                          <HStack spacing={2}>
                            <Button size="xs" onClick={() => openEditUser(u)}>Edit</Button>
                            {u.is_active && (
                              <Button size="xs" colorScheme="red" onClick={() => handleUserDeactivate(u.id)}>
                                Deactivate
                              </Button>
                            )}
                          </HStack>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </TabPanel>

          {/* Vehicles Tab */}
          <TabPanel>
            <Flex direction={{ base: 'column', md: 'row' }} mb={4} gap={4}>
              <Button colorScheme="green" onClick={openCreateVehicle}>Add Vehicle</Button>
              <Spacer />
              <Text fontSize="sm" color="gray.600">
                Showing {vehicles.length} vehicles
              </Text>
            </Flex>
            
            {loadingVehicles ? (
              <Flex justify="center" py={8}>
                <Spinner size="lg" />
              </Flex>
            ) : (
              <Box overflowX="auto">
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th>Plate</Th>
                      <Th>Make</Th>
                      <Th>Model</Th>
                      <Th>Color</Th>
                      <Th>Owner ID</Th>
                      <Th>Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {vehicles.map(v => (
                      <Tr key={v.id}>
                        <Td fontWeight="bold">{v.plate_number}</Td>
                        <Td>{v.make}</Td>
                        <Td>{v.model}</Td>
                        <Td>
                          <HStack spacing={2}>
                            <Box w={3} h={3} bg={v.color.toLowerCase()} borderRadius="full" />
                            <Text>{v.color}</Text>
                          </HStack>
                        </Td>
                        <Td>{v.owner_id}</Td>
                        <Td>
                          <HStack spacing={2}>
                            <Button size="xs" onClick={() => openEditVehicle(v)}>Edit</Button>
                            <Button size="xs" colorScheme="red" onClick={() => handleVehicleDelete(v.id)}>
                              Delete
                            </Button>
                          </HStack>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </TabPanel>

          {/* Access Logs Tab */}
          <TabPanel>
            <Flex direction={{ base: 'column', md: 'row' }} mb={4} gap={4}>
              <Heading size="md">Access Logs</Heading>
              <Spacer />
              <Text fontSize="sm" color="gray.600">
                Showing {logs.length} recent logs
              </Text>
            </Flex>
            
            {loadingLogs ? (
              <Flex justify="center" py={8}>
                <Spinner size="lg" />
              </Flex>
            ) : (
              <Box overflowX="auto">
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th>Plate</Th>
                      <Th>Action</Th>
                      <Th>Timestamp</Th>
                      <Th>Guard</Th>
                      <Th>Vehicle ID</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {logs.map(log => (
                      <Tr key={log.id}>
                        <Td fontWeight="bold">{log.plate_number}</Td>
                        <Td>
                          <Badge colorScheme={log.action === 'Entry' ? 'green' : 'red'} variant="subtle">
                            {log.action}
                          </Badge>
                        </Td>
                        <Td>{new Date(log.timestamp).toLocaleString()}</Td>
                        <Td>{log.user_id}</Td>
                        <Td>{log.vehicle_id}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </TabPanel>
        </TabPanels>
      </Tabs>

      {/* User Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">
            {editingUser ? 'Edit User' : 'Create User'}
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel color="gray.700">Full Name</FormLabel>
                <Input
                  name="full_name"
                  value={userForm.full_name}
                  onChange={handleUserFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Email</FormLabel>
                <Input
                  name="email"
                  type="email"
                  value={userForm.email}
                  onChange={handleUserFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              {!editingUser && (
                <FormControl isRequired>
                  <FormLabel color="gray.700">Password</FormLabel>
                  <Input
                    name="password"
                    type="password"
                    value={userForm.password}
                    onChange={handleUserFormChange}
                    borderRadius="lg"
                    boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                    border="1px solid"
                    borderColor="gray.200"
                    _focus={{
                      boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                      borderColor: 'brand.400',
                    }}
                  />
                </FormControl>
              )}
              <FormControl isRequired>
                <FormLabel color="gray.700">Role</FormLabel>
                <Select
                  name="role"
                  value={userForm.role}
                  onChange={handleUserFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                >
                  <option value="admin">Admin</option>
                  <option value="guard">Guard</option>
                  <option value="user">User</option>
                </Select>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="brand"
                onClick={handleUserSubmit}
                _hover={{
                  bg: 'brand.50',
                  color: 'brand.600',
                  boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
                }}
              >
                {editingUser ? 'Update' : 'Create'}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Vehicle Modal */}
      <Modal isOpen={isVehicleOpen} onClose={onVehicleClose} size="lg">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">
            {editingVehicle ? 'Edit Vehicle' : 'Register Vehicle'}
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel color="gray.700">Plate Number</FormLabel>
                <Input
                  name="plate_number"
                  value={vehicleForm.plate_number}
                  onChange={handleVehicleFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Make</FormLabel>
                <Input
                  name="make"
                  value={vehicleForm.make}
                  onChange={handleVehicleFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Model</FormLabel>
                <Input
                  name="model"
                  value={vehicleForm.model}
                  onChange={handleVehicleFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Color</FormLabel>
                <Input
                  name="color"
                  value={vehicleForm.color}
                  onChange={handleVehicleFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Owner ID</FormLabel>
                <Input
                  name="owner_id"
                  value={vehicleForm.owner_id}
                  onChange={handleVehicleFormChange}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onVehicleClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="brand"
                onClick={handleVehicleSubmit}
                _hover={{
                  bg: 'brand.50',
                  color: 'brand.600',
                  boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
                }}
              >
                {editingVehicle ? 'Update' : 'Register'}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Security Settings Modal */}
      <Modal isOpen={isSecurityOpen} onClose={onSecurityClose} size="lg">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">Security Settings</ModalHeader>
          <ModalBody>
            <VStack spacing={6}>
              <FormControl>
                <FormLabel color="gray.700">Camera Sensitivity</FormLabel>
                <HStack spacing={4}>
                  <Slider
                    value={securitySettings.cameraSensitivity}
                    onChange={(value) => handleSecuritySettingChange('cameraSensitivity', value)}
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
                  <Text fontWeight="bold" minW="3rem">{securitySettings.cameraSensitivity}%</Text>
                </HStack>
                <FormHelperText>Adjust camera detection sensitivity</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel color="gray.700">Alert Threshold</FormLabel>
                <Select
                  value={securitySettings.alertThreshold}
                  onChange={(e) => handleSecuritySettingChange('alertThreshold', parseInt(e.target.value))}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                >
                  <option value={1}>Low (1 alert)</option>
                  <option value={3}>Medium (3 alerts)</option>
                  <option value={5}>High (5 alerts)</option>
                  <option value={10}>Critical (10 alerts)</option>
                </Select>
                <FormHelperText>Number of alerts before escalation</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel color="gray.700">Auto Lock System</FormLabel>
                <Switch
                  isChecked={securitySettings.autoLock}
                  onChange={(e) => handleSecuritySettingChange('autoLock', e.target.checked)}
                  colorScheme="brand"
                />
                <FormHelperText>Automatically lock gates after unauthorized access</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel color="gray.700">Emergency Mode</FormLabel>
                <Switch
                  isChecked={securitySettings.emergencyMode}
                  onChange={(e) => handleSecuritySettingChange('emergencyMode', e.target.checked)}
                  colorScheme="red"
                />
                <FormHelperText>Enable emergency lockdown procedures</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel color="gray.700">Backup Frequency</FormLabel>
                <Select
                  value={securitySettings.backupFrequency}
                  onChange={(e) => handleSecuritySettingChange('backupFrequency', e.target.value)}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </Select>
                <FormHelperText>How often to backup system data</FormHelperText>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={4}>
              <Button variant="ghost" onClick={onSecurityClose}>
                Cancel
              </Button>
              <Button
                variant="neumorphic"
                colorScheme="brand"
                onClick={handleSecuritySave}
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

      {/* System Reports Modal */}
      <Modal isOpen={isReportsOpen} onClose={onReportsClose} size="xl">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
          boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
          border="1px solid"
          borderColor="gray.200"
        >
          <ModalHeader color="gray.700">System Reports</ModalHeader>
          <ModalBody>
            <VStack spacing={6}>
              <FormControl>
                <FormLabel color="gray.700">Report Type</FormLabel>
                <Select
                  value={selectedReport}
                  onChange={(e) => setSelectedReport(e.target.value)}
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                >
                  <option value="daily">Daily Report</option>
                  <option value="weekly">Weekly Report</option>
                  <option value="monthly">Monthly Report</option>
                </Select>
              </FormControl>

              {reportData && (
                <Box
                  bg="gray.50"
                  p={6}
                  borderRadius="xl"
                  border="1px solid"
                  borderColor="gray.200"
                  w="full"
                >
                  <Heading size="md" mb={4} color="gray.700">
                    {selectedReport.charAt(0).toUpperCase() + selectedReport.slice(1)} Report Summary
                  </Heading>
                  <SimpleGrid columns={2} spacing={4}>
                    <Stat>
                      <StatLabel>Total Access</StatLabel>
                      <StatNumber color="brand.500">{reportData.totalAccess}</StatNumber>
                    </Stat>
                    <Stat>
                      <StatLabel>Authorized Access</StatLabel>
                      <StatNumber color="green.500">{reportData.authorizedAccess}</StatNumber>
                    </Stat>
                    <Stat>
                      <StatLabel>Unauthorized Access</StatLabel>
                      <StatNumber color="red.500">{reportData.unauthorizedAccess}</StatNumber>
                    </Stat>
                    <Stat>
                      <StatLabel>Alerts</StatLabel>
                      <StatNumber color="orange.500">{reportData.alerts}</StatNumber>
                    </Stat>
                    <Stat gridColumn="span 2">
                      <StatLabel>System Uptime</StatLabel>
                      <StatNumber color="blue.500">{reportData.systemUptime}%</StatNumber>
                    </Stat>
                  </SimpleGrid>
                </Box>
              )}

              <HStack spacing={4} w="full">
                <Button
                  variant="neumorphic"
                  colorScheme="brand"
                  onClick={generateReport}
                  isLoading={generatingReport}
                  loadingText="Generating..."
                  flex={1}
                  _hover={{
                    bg: 'brand.50',
                    color: 'brand.600',
                    boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
                  }}
                >
                  Generate Report
                </Button>
                {reportData && (
                  <Button
                    variant="neumorphic"
                    leftIcon={<FiDownload />}
                    onClick={exportReport}
                    flex={1}
                    _hover={{
                      bg: 'brand.50',
                      color: 'brand.600',
                      boxShadow: '6px 6px 12px #bae6fd, -6px -6px 12px #ffffff',
                    }}
                  >
                    Export Report
                  </Button>
                )}
              </HStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={onReportsClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default AdminDashboard; 