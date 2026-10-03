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
  Grid,
  FormControl,
  FormHelperText
} from '@chakra-ui/react';
import {
  FiUsers,
  FiTruck,
  FiActivity,
  FiAlertTriangle,
  
  
  FiRefreshCw,
  FiTrendingUp,
  
  FiClock,
} from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { mockAuthEnabled } from '../config';
import WatchlistManager from '../components/WatchlistManager';
import VisitHistory from '../components/VisitHistory';
import UserAccountActions from '../components/UserAccountActions';
import { useAuth } from '../context/AuthContext';
import { asArray, asObject, asNumber, apiMessage } from '../utils/safe';
import { decisionLabel, decisionScheme, mismatchLabel, mismatchScheme } from '../utils/labels';

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
  color: string | null;
  vehicle_type?: string | null;
  owner_id: string | null;
}

// Suggestions only: the detector's labels vary by model, and equivalences
// (e.g. SUV = crossover) are declared as attribute rules.
const VEHICLE_TYPES = ['sedan', 'hatchback', 'suv', 'van', 'pickup', 'truck', 'motorcycle', 'bus'];

type VehicleForm = { plate_number: string; make: string; model: string; color: string; vehicle_type: string; owner_id: string };
const EMPTY_VEHICLE: VehicleForm = { plate_number: '', make: '', model: '', color: '', vehicle_type: '', owner_id: '' };

interface Log {
  id: string;
  plate_number: string;
  timestamp: string;
  action: string;
  user_id: string;
  vehicle_id: string;
}

interface RecentAlert {
  id: string;
  plate_number: string;
  mismatch_type: string;
  status: string;
  timestamp: string;
}

// null until loaded: a "0" while loading reads as "there are none".
interface Analytics {
  totalVehicles: number | null;
  totalLogs: number | null;
  weeklyGrowth: number;
  pendingAlerts: number | null;
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
  const [loadError, setLoadError] = useState('');

  const [recentAlerts, setRecentAlerts] = useState<RecentAlert[]>([]);
  const navigate = useNavigate();

  // User Management
  const [users, setUsers] = useState<User[]>([]);
  const [userForm, setUserForm] = useState<Omit<User, 'id' | 'is_active'>>({ full_name: '', email: '', password: '', role: 'guard' });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Vehicle Management
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(EMPTY_VEHICLE);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const { isOpen: isVehicleOpen, onOpen: onVehicleOpen, onClose: onVehicleClose } = useDisclosure();
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  // Access Logs
  const [logs, setLogs] = useState<Log[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Analytics
  const [analytics, setAnalytics] = useState<Analytics>({
    totalVehicles: null,
    totalLogs: null,
    weeklyGrowth: 0,
    pendingAlerts: null
  });

  // Responsive design
  const cardBg = useColorModeValue('white', 'gray.700');

  // Recent alerts, and how many still await a guard's decision
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/alerts', { params: { limit: 3 } }),
      api.get('/alerts', { params: { limit: 1, feedback_status: 'pending' } }),
    ])
      .then(([recent, pending]) => {
        if (cancelled) return;
        setRecentAlerts(asArray<RecentAlert>(asObject<{ alerts: unknown }>(recent.data).alerts));
        setAnalytics(prev => ({ ...prev, pendingAlerts: asNumber(asObject<{ total: number }>(pending.data).total) }));
      })
      .catch(error => {
        if (!cancelled) setLoadError(apiMessage(error, 'Failed to load alerts'));
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch users
  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    api.get('/users')
      .then((res) => {
        if (cancelled) return;
        const userData = asArray<User>(res.data);
        setUsers(userData);
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
      })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, []);

  // Fetch vehicles
  useEffect(() => {
    let cancelled = false;
    setLoadingVehicles(true);
    // Paginated: the endpoint no longer returns the whole register.
    api.get('/vehicles', { params: { limit: 200 } })
      .then((res) => {
        if (cancelled) return;
        const vehicleData = asArray<Vehicle>(asObject<{ vehicles: Vehicle[] }>(res.data).vehicles);
        setVehicles(vehicleData);
        // Use the server's total, not the page length, or the tile under-reports.
        setAnalytics(prev => ({
          ...prev,
          totalVehicles: asNumber(asObject<{ total: number }>(res.data).total, vehicleData.length),
        }));
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
    api.get('/logs', { params: { limit: 200 } })
      .then((res) => {
        if (cancelled) return;
        const payload = asObject<{ logs: Log[]; total: number }>(res.data);
        const logData = asArray<Log>(payload.logs);
        setLogs(logData);
        setAnalytics(prev => ({
          ...prev,
          totalLogs: asNumber(payload.total, logData.length),
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
  const handleUserReactivate = async (id: string) => {
    try {
      const { data } = await api.patch<User>(`/users/${id}`, { is_active: true });
      setUsers(prev => prev.map(u => (u.id === id ? data : u)));
      toast({ title: 'User reactivated', status: 'success' });
    } catch (error) {
      toast({ title: 'Error', description: apiMessage(error, 'Failed to reactivate user'), status: 'error' });
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
  const handleVehicleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setVehicleForm({ ...vehicleForm, [e.target.name]: e.target.value });
  const openEditVehicle = (v: Vehicle) => {
    setEditingVehicle(v);
    setVehicleForm({
      plate_number: v.plate_number,
      make: v.make ?? '',
      model: v.model ?? '',
      color: v.color ?? '',
      vehicle_type: v.vehicle_type ?? '',
      owner_id: v.owner_id ?? '',
    });
    onVehicleOpen();
  };
  const openCreateVehicle = () => { setEditingVehicle(null); setVehicleForm(EMPTY_VEHICLE); onVehicleOpen(); };
  
  const handleVehicleSubmit = async () => {
    try {
      if (editingVehicle) {
        // The plate itself is immutable: changing it would silently rewrite the
        // vehicle that historical access logs and alerts refer to.
        const { plate_number: _plate, ...editable } = vehicleForm;
        const { data } = await api.patch<Vehicle>(`/vehicles/${editingVehicle.id}`, {
          ...editable,
          vehicle_type: editable.vehicle_type || null,
          owner_id: editable.owner_id || null,
        });
        setVehicles(prev => prev.map(v => (v.id === editingVehicle.id ? data : v)));
        toast({ title: 'Vehicle updated', status: 'success' });
      } else {
        const payload = {
          ...vehicleForm,
          vehicle_type: vehicleForm.vehicle_type || null,
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

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'purple';
      case 'guard': return 'blue';
      case 'user': return 'green';
      default: return 'gray';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'red';
      case 'in_progress': return 'yellow';
      case 'closed': return 'green';
      default: return 'gray';
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
                }}
              >
                Refresh
              </Button>
            </HStack>
          </HStack>
        </Box>
      </VStack>

      {/* Stats Grid */}
      <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={6} mb={8}>
        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          border="1px solid"
          borderColor="gray.200"
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
              border="1px solid"
              borderColor="brand.200"
            >
              <Icon as={FiUsers} w={6} h={6} color="brand.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {loadingUsers && users.length === 0 ? '—' : users.length}
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
          border="1px solid"
          borderColor="gray.200"
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
              border="1px solid"
              borderColor="green.200"
            >
              <Icon as={FiTruck} w={6} h={6} color="green.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {analytics.totalVehicles ?? '—'}
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
          border="1px solid"
          borderColor="gray.200"
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
              border="1px solid"
              borderColor="red.200"
            >
              <Icon as={FiAlertTriangle} w={6} h={6} color="red.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {analytics.pendingAlerts ?? '—'}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">Pending Alerts</StatLabel>
              </Stat>
            </VStack>
          </HStack>
        </Box>

        <Box
          bg={cardBg}
          p={6}
          borderRadius="xl"
          border="1px solid"
          borderColor="gray.200"
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
              border="1px solid"
              borderColor="purple.200"
            >
              <Icon as={FiTrendingUp} w={6} h={6} color="purple.500" />
            </Box>
            <VStack align="start" spacing={1}>
              <Stat>
                <StatNumber fontSize="2xl" fontWeight="bold" color="gray.700">
                  {analytics.totalLogs ?? '—'}
                </StatNumber>
                <StatLabel color="gray.600" fontSize="sm">Recent Activities</StatLabel>
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
          border="1px solid"
          borderColor="gray.200"
          overflow="hidden"
        >
          <Box p={6} borderBottom="1px solid" borderColor="gray.200">
            <HStack justify="space-between">
              <Heading size="md" color="gray.700">Recent Alerts</Heading>
              <Button size="sm" variant="ghost" color="brand.500" onClick={() => navigate('/alert-history')}>
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
                  }}
                >
                  <HStack justify="space-between" mb={2}>
                    <HStack spacing={2}>
                      <Icon as={FiAlertTriangle} color={`${mismatchScheme(alert.mismatch_type)}.500`} />
                      <Text fontWeight="semibold" color="gray.700">
                        {alert.plate_number}
                      </Text>
                    </HStack>
                    <Badge colorScheme={getStatusColor(alert.status)} variant="subtle">
                      {{ open: 'Open', in_progress: 'In progress', closed: 'Closed' }[alert.status] ?? alert.status}
                    </Badge>
                  </HStack>
                  <HStack spacing={4} fontSize="sm" color="gray.600">
                    <Text>{mismatchLabel(alert.mismatch_type)}</Text>
                    <HStack spacing={1}>
                      <Icon as={FiClock} />
                      <Text>{new Date(alert.timestamp).toLocaleString()}</Text>
                    </HStack>
                  </HStack>
                </Box>
              ))}
              {recentAlerts.length === 0 && <Text color="gray.500">No alerts yet.</Text>}
            </VStack>
          </Box>
        </Box>

        {/* Recent Activity */}
        <Box
          bg={cardBg}
          borderRadius="xl"
          border="1px solid"
          borderColor="gray.200"
          overflow="hidden"
        >
          <Box p={6} borderBottom="1px solid" borderColor="gray.200">
            <HStack justify="space-between">
              <Heading size="md" color="gray.700">Recent Access</Heading>
            </HStack>
          </Box>
          <Box p={6}>
            <VStack spacing={4} align="stretch">
              {logs.slice(0, 4).map((log) => (
                <Box
                  key={log.id}
                  p={4}
                  borderRadius="lg"
                  bg="gray.50"
                  border="1px solid"
                  borderColor="gray.200"
                >
                  <HStack justify="space-between">
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="semibold" color="gray.700">
                        {log.plate_number}
                      </Text>
                      <Badge colorScheme={decisionScheme(log.action)} variant="subtle">
                        {decisionLabel(log.action)}
                      </Badge>
                    </VStack>
                    <Text fontSize="xs" color="gray.500">
                      {new Date(log.timestamp).toLocaleString()}
                    </Text>
                  </HStack>
                </Box>
              ))}
              {logs.length === 0 && <Text color="gray.500">No access decisions yet.</Text>}
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
            }}
          >
            Register Vehicle
          </Button>
          <Button
            variant="neumorphic"
            leftIcon={<FiActivity />}
            onClick={() => navigate('/analytics')}
            _hover={{
              bg: 'brand.50',
              color: 'brand.600',
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
            }}
          >
            Refresh Data
          </Button>
        </HStack>
      </Box>

      <Tabs variant="enclosed">
        <TabList>
          <Tab>Users</Tab>
          <Tab>Vehicles</Tab>
          <Tab>Access Logs</Tab>
          <Tab>Watchlist</Tab>
          <Tab>Visits</Tab>
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
                            {u.is_active ? (
                              u.id !== currentUser?.id && (
                                <Button size="xs" colorScheme="orange" variant="outline" onClick={() => handleUserDeactivate(u.id)}>
                                  Deactivate
                                </Button>
                              )
                            ) : (
                              <Button size="xs" colorScheme="green" variant="outline" onClick={() => handleUserReactivate(u.id)}>
                                Reactivate
                              </Button>
                            )}
                            <UserAccountActions
                              user={u}
                              isSelf={u.id === currentUser?.id}
                              onDeleted={(id) => setUsers(prev => prev.filter(x => x.id !== id))}
                            />
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
                      <Th>Type</Th>
                      <Th>Owner</Th>
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
                            {v.color && <Box w={3} h={3} bg={v.color.toLowerCase()} borderRadius="full" />}
                            <Text>{v.color || '—'}</Text>
                          </HStack>
                        </Td>
                        <Td>{v.vehicle_type || '—'}</Td>
                        <Td>{users.find(u => u.id === v.owner_id)?.full_name ?? (v.owner_id ? 'Unknown user' : '—')}</Td>
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
                      <Th>Decision</Th>
                      <Th>When</Th>
                      <Th>By</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {logs.map(log => (
                      <Tr key={log.id}>
                        <Td fontWeight="bold">{log.plate_number}</Td>
                        <Td>
                          <Badge colorScheme={decisionScheme(log.action)} variant="subtle">
                            {decisionLabel(log.action)}
                          </Badge>
                        </Td>
                        <Td>{new Date(log.timestamp).toLocaleString()}</Td>
                        <Td>{users.find(u => u.id === log.user_id)?.full_name ?? '—'}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </TabPanel>
          <TabPanel>
            <WatchlistManager />
          </TabPanel>
          <TabPanel>
            <VisitHistory />
          </TabPanel>
        </TabPanels>
      </Tabs>

      {/* User Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent
          borderRadius="xl"
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
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel color="gray.700">Email</FormLabel>
                <Input
                  name="email"
                  type="email"
                  autoComplete="off"
                  value={userForm.email}
                  onChange={handleUserFormChange}
                  borderRadius="lg"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
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
                    autoComplete="new-password"
                    value={userForm.password}
                    onChange={handleUserFormChange}
                    borderRadius="lg"
                    border="1px solid"
                    borderColor="gray.200"
                    _focus={{
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
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
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
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
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
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
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
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
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
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    borderColor: 'brand.400',
                  }}
                />
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Type</FormLabel>
                <Input
                  name="vehicle_type"
                  list="vehicle-types"
                  value={vehicleForm.vehicle_type}
                  onChange={handleVehicleFormChange}
                  placeholder="e.g. sedan"
                  borderRadius="lg"
                />
                <datalist id="vehicle-types">
                  {VEHICLE_TYPES.map(t => <option key={t} value={t} />)}
                </datalist>
                <FormHelperText>Compared with the detected type to flag mismatches.</FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel color="gray.700">Owner</FormLabel>
                <Select name="owner_id" value={vehicleForm.owner_id} onChange={handleVehicleFormChange} borderRadius="lg">
                  <option value="">No owner</option>
                  {users.filter(u => u.is_active || u.id === vehicleForm.owner_id).map(u => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                  ))}
                </Select>
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
                }}
              >
                {editingVehicle ? 'Update' : 'Register'}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>


    </Box>
  );
};

export default AdminDashboard; 