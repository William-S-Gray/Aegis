import React, { useState, useEffect } from 'react';
import {
  Box, Heading, Text, VStack, HStack, Card, CardBody, CardHeader, Badge, Button, 
  SimpleGrid, Stat, StatLabel, StatNumber, StatHelpText, Flex, 
  useColorModeValue,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure,
  Spinner, Icon
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { asArray, asObject, asNumber } from '../utils/safe';
import { FiTruck, FiClock, FiShield, FiCalendar } from 'react-icons/fi';

interface Vehicle {
  id: string;
  plate_number: string;
  make: string;
  model: string;
  // Optional in the register; a vehicle without one used to crash this page.
  color: string | null;
  owner_id: string;
}

interface AccessLog {
  id: string;
  plate_number: string;
  timestamp: string;
  action: string;
  user_id: string;
  vehicle_id: string;
}

const UserPortal: React.FC = () => {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalVehicles: 0,
    totalAccesses: 0,
    thisMonth: 0,
    lastAccess: 'Never'
  });
  
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  // Responsive design
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  // Keyed on identity, not the object: a new object for the same user must not
  // refetch and flash the spinner.
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);

    // Both endpoints scope their results to the caller server-side, so a user
    // only ever receives their own vehicles and access history.
    Promise.all([
      api.get('/vehicles').catch(() => ({ data: {} })),
      api.get('/logs').catch(() => ({ data: {} })),
    ])
      .then(([vehicleRes, logRes]) => {
        if (cancelled) return;
        // Both endpoints return a paginated envelope.
        const ownVehicles = asArray<Vehicle>(
          asObject<{ vehicles: Vehicle[] }>(vehicleRes.data).vehicles
        );
        const logPayload = asObject<{ logs: AccessLog[]; total: number }>(logRes.data);
        const logs = asArray<AccessLog>(logPayload.logs);

        setVehicles(ownVehicles);
        setAccessLogs(logs);

        const now = new Date();
        const thisMonth = logs.filter(log => {
          const logDate = new Date(log.timestamp);
          return (
            logDate.getMonth() === now.getMonth() &&
            logDate.getFullYear() === now.getFullYear()
          );
        }).length;

        setStats({
          totalVehicles: ownVehicles.length,
          totalAccesses: asNumber(logPayload.total, logs.length),
          thisMonth,
          lastAccess: logs.length
            ? new Date(logs[0].timestamp).toLocaleDateString()
            : 'Never',
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleVehicleClick = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    onOpen();
  };

  const isInbound = (action: string) => ['entry', 'approve'].includes(action.toLowerCase());
  const getActionColor = (action: string) => (isInbound(action) ? 'green' : 'red');
  const getActionIcon = (action: string) => (isInbound(action) ? '→' : '←');

  if (loading) {
    return (
      <Box p={{ base: 4, md: 8 }} bg="gray.50" minH="100vh">
        <Flex justify="center" align="center" minH="400px">
          <VStack spacing={4}>
            <Spinner size="lg" />
            <Text>Loading your portal...</Text>
          </VStack>
        </Flex>
      </Box>
    );
  }

  return (
    <Box p={{ base: 4, md: 8 }} bg="gray.50" minH="100vh">
      {/* Header */}
      <VStack spacing={4} mb={8} align="stretch">
        <Heading size="lg">Welcome, {user?.email}</Heading>
        <Text color="gray.600">Manage your vehicles and view access history</Text>
      </VStack>

      {/* Stats Overview */}
      <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={6} mb={8}>
        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">
                <HStack spacing={2}>
                  <Icon as={FiTruck} />
                  <Text>My Vehicles</Text>
                </HStack>
              </StatLabel>
              <StatNumber fontSize="2xl" color="blue.500">{stats.totalVehicles}</StatNumber>
              <StatHelpText>Registered vehicles</StatHelpText>
            </Stat>
          </CardBody>
        </Card>

        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">
                <HStack spacing={2}>
                  <Icon as={FiShield} />
                  <Text>Total Accesses</Text>
                </HStack>
              </StatLabel>
              <StatNumber fontSize="2xl" color="green.500">{stats.totalAccesses}</StatNumber>
              <StatHelpText>All time entries/exits</StatHelpText>
            </Stat>
          </CardBody>
        </Card>

        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">
                <HStack spacing={2}>
                  <Icon as={FiCalendar} />
                  <Text>This Month</Text>
                </HStack>
              </StatLabel>
              <StatNumber fontSize="2xl" color="orange.500">{stats.thisMonth}</StatNumber>
              <StatHelpText>Accesses this month</StatHelpText>
            </Stat>
          </CardBody>
        </Card>

        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardBody>
            <Stat>
              <StatLabel color="gray.600">
                <HStack spacing={2}>
                  <Icon as={FiClock} />
                  <Text>Last Access</Text>
                </HStack>
              </StatLabel>
              <StatNumber fontSize="2xl" color="purple.500">{stats.lastAccess}</StatNumber>
              <StatHelpText>Most recent entry/exit</StatHelpText>
            </Stat>
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Main Content Grid */}
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={8}>
        {/* My Vehicles */}
        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardHeader>
            <Heading size="md">
              <HStack spacing={2}>
                <Icon as={FiTruck} />
                <Text>My Vehicles</Text>
              </HStack>
            </Heading>
          </CardHeader>
          <CardBody>
            {vehicles.length === 0 ? (
              <VStack spacing={4} py={8}>
                <Icon as={FiTruck} w={8} h={8} color="gray.400" />
                <Text color="gray.500">No vehicles registered</Text>
                <Text fontSize="sm" color="gray.400">Contact admin to register your vehicle</Text>
              </VStack>
            ) : (
              <VStack spacing={4} align="stretch">
                {vehicles.map((vehicle) => (
                  <Card 
                    key={vehicle.id} 
                    variant="outline" 
                    cursor="pointer"
                    _hover={{ bg: 'gray.50' }}
                    onClick={() => handleVehicleClick(vehicle)}
                  >
                    <CardBody>
                      <Flex direction={{ base: 'column', md: 'row' }} justify="space-between" align={{ base: 'start', md: 'center' }}>
                        <VStack align="start" spacing={2}>
                          <HStack spacing={3}>
                            <Text fontWeight="bold" fontSize="lg">{vehicle.plate_number}</Text>
                            <Badge colorScheme="blue" variant="subtle">Active</Badge>
                          </HStack>
                          <Text color="gray.600">{vehicle.make} {vehicle.model}</Text>
                          <HStack spacing={2}>
                            <Box w={3} h={3} bg={vehicle.color?.toLowerCase() ?? 'gray.300'} borderRadius="full" />
                            <Text fontSize="sm" color="gray.500">{vehicle.color ?? 'Colour not recorded'}</Text>
                          </HStack>
                        </VStack>
                        <Button size="sm" colorScheme="blue" variant="ghost">
                          View Details
                        </Button>
                      </Flex>
                    </CardBody>
                  </Card>
                ))}
              </VStack>
            )}
          </CardBody>
        </Card>

        {/* Recent Access History */}
        <Card bg={bgColor} border="1px" borderColor={borderColor}>
          <CardHeader>
            <Heading size="md">
              <HStack spacing={2}>
                <Icon as={FiClock} />
                <Text>Recent Access History</Text>
              </HStack>
            </Heading>
          </CardHeader>
          <CardBody>
            {accessLogs.length === 0 ? (
              <VStack spacing={4} py={8}>
                <Icon as={FiClock} w={8} h={8} color="gray.400" />
                <Text color="gray.500">No access history</Text>
                <Text fontSize="sm" color="gray.400">Your vehicle access logs will appear here</Text>
              </VStack>
            ) : (
              <VStack spacing={3} align="stretch">
                {accessLogs.slice(0, 5).map((log) => (
                  <Flex 
                    key={log.id} 
                    justify="space-between" 
                    align="center" 
                    p={3} 
                    bg="gray.50" 
                    borderRadius="md"
                  >
                    <HStack spacing={3}>
                      <Badge colorScheme={getActionColor(log.action)} variant="subtle">
                        {getActionIcon(log.action)} {log.action}
                      </Badge>
                      <Text fontWeight="medium">{log.plate_number}</Text>
                    </HStack>
                    <Text fontSize="sm" color="gray.500">
                      {new Date(log.timestamp).toLocaleDateString()}
                    </Text>
                  </Flex>
                ))}
                {accessLogs.length > 5 && (
                  <Button size="sm" variant="ghost" colorScheme="blue">
                    View All ({accessLogs.length} total)
                  </Button>
                )}
              </VStack>
            )}
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Vehicle Details Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Vehicle Details</ModalHeader>
          <ModalBody>
            {selectedVehicle && (
              <VStack spacing={6} align="stretch">
                {/* Vehicle Info */}
                <Card variant="outline">
                  <CardHeader>
                    <Heading size="sm">Vehicle Information</Heading>
                  </CardHeader>
                  <CardBody>
                    <SimpleGrid columns={2} spacing={4}>
                      <Box>
                        <Text fontSize="sm" color="gray.600">Plate Number</Text>
                        <Text fontWeight="bold">{selectedVehicle.plate_number}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="sm" color="gray.600">Make</Text>
                        <Text>{selectedVehicle.make}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="sm" color="gray.600">Model</Text>
                        <Text>{selectedVehicle.model}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="sm" color="gray.600">Color</Text>
                        <HStack spacing={2}>
                          <Box w={3} h={3} bg={selectedVehicle.color?.toLowerCase() ?? 'gray.300'} borderRadius="full" />
                          <Text>{selectedVehicle.color ?? 'Not recorded'}</Text>
                        </HStack>
                      </Box>
                    </SimpleGrid>
                  </CardBody>
                </Card>

                {/* Access Statistics */}
                <Card variant="outline">
                  <CardHeader>
                    <Heading size="sm">Access Statistics</Heading>
                  </CardHeader>
                  <CardBody>
                    <VStack spacing={4} align="stretch">
                      <HStack justify="space-between">
                        <Text>Total Accesses</Text>
                        <Text fontWeight="bold">
                          {accessLogs.filter(log => log.plate_number === selectedVehicle.plate_number).length}
                        </Text>
                      </HStack>
                      <HStack justify="space-between">
                        <Text>This Month</Text>
                        <Text fontWeight="bold">
                          {accessLogs.filter(log => {
                            const logDate = new Date(log.timestamp);
                            const now = new Date();
                            return log.plate_number === selectedVehicle.plate_number &&
                                   logDate.getMonth() === now.getMonth() && 
                                   logDate.getFullYear() === now.getFullYear();
                          }).length}
                        </Text>
                      </HStack>
                      <HStack justify="space-between">
                        <Text>Last Access</Text>
                        <Text fontWeight="bold">
                          {(() => {
                            const vehicleLogs = accessLogs.filter(log => log.plate_number === selectedVehicle.plate_number);
                            return vehicleLogs.length > 0 
                              ? new Date(vehicleLogs[0].timestamp).toLocaleDateString()
                              : 'Never';
                          })()}
                        </Text>
                      </HStack>
                    </VStack>
                  </CardBody>
                </Card>
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="blue" mr={3} onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default UserPortal; 