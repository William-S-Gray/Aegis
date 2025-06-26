import React, { useState, useEffect } from 'react';
import { 
  Box, Flex, Button, Spacer, Heading, Link as ChakraLink, HStack, VStack, 
  Text, Avatar, Menu, MenuButton, MenuList, MenuItem, MenuDivider,
  Badge, IconButton, useDisclosure, Drawer, DrawerBody, DrawerHeader,
  DrawerOverlay, DrawerContent, DrawerCloseButton, useBreakpointValue,
  Divider, Tooltip, useColorModeValue, useToast, Icon
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import { Link as RouterLink, useNavigate, useLocation } from 'react-router-dom';
import type { LinkProps as RouterLinkProps } from 'react-router-dom';
import { 
  FiUser, FiLogOut, FiSettings, FiBell, FiMenu, FiHome, FiShield, 
  FiUsers, FiActivity, FiWifi, FiWifiOff, FiBattery, FiBatteryCharging,
  FiChevronDown, FiChevronRight, FiSearch, FiHelpCircle, FiMessageSquare
} from 'react-icons/fi';

const LinkWithRef = React.forwardRef<HTMLAnchorElement, RouterLinkProps>((props, ref) => (
  <RouterLink ref={ref} {...props} />
));

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();
  
  // Responsive design
  const isMobile = useBreakpointValue({ base: true, md: false });
  const isTablet = useBreakpointValue({ base: false, lg: false, xl: true });
  
  // Theme colors
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const textColor = useColorModeValue('gray.700', 'gray.200');

  // State
  const [notifications, setNotifications] = useState([
    { id: 1, message: 'New vehicle detected at Main Gate', time: '2 min ago', read: false, type: 'alert' },
    { id: 2, message: 'System maintenance scheduled for tonight', time: '1 hour ago', read: false, type: 'info' },
    { id: 3, message: 'Camera 2 connection restored', time: '3 hours ago', read: true, type: 'success' }
  ]);

  const [systemStatus, setSystemStatus] = useState({
    cameras: 'online',
    database: 'online',
    api: 'online',
    websocket: 'online'
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast({
      title: 'Logged out successfully',
      status: 'success',
      duration: 2000,
    });
  };

  const handleNotificationClick = (notificationId: number) => {
    setNotifications(prev => 
      prev.map(notif => 
        notif.id === notificationId ? { ...notif, read: true } : notif
      )
    );
  };

  const getBreadcrumbs = () => {
    const path = location.pathname;
    if (path === '/') return [{ name: 'Home', path: '/' }];
    if (path === '/admin') return [{ name: 'Home', path: '/' }, { name: 'Admin Dashboard', path: '/admin' }];
    if (path === '/guard') return [{ name: 'Home', path: '/' }, { name: 'Guard Dashboard', path: '/guard' }];
    if (path === '/user') return [{ name: 'Home', path: '/' }, { name: 'User Portal', path: '/user' }];
    return [{ name: 'Home', path: '/' }];
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'guard': return 'Security Guard';
      case 'user': return 'User';
      default: return role;
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

  const unreadNotifications = notifications.filter(n => !n.read).length;

  return (
    <>
      <Box 
        bg={bgColor}
        px={{ base: 4, md: 6 }} 
        py={4} 
        color={textColor}
        boxShadow="0 4px 8px rgba(0,0,0,0.1)"
        borderBottom="1px solid"
        borderColor={borderColor}
        position="sticky"
        top={0}
        zIndex={1000}
      >
        <Flex align="center">
          {/* Logo and Brand */}
          <HStack spacing={4}>
            <Heading 
              size="lg" 
              bgGradient="linear(to-r, brand.500, brand.600)"
              bgClip="text"
              fontWeight="bold"
              cursor="pointer"
              onClick={() => navigate('/')}
            >
              Aegis
            </Heading>
            
            {/* Breadcrumbs */}
            {!isMobile && (
              <HStack spacing={2} ml={6}>
                {getBreadcrumbs().map((crumb, index) => (
                  <HStack key={crumb.path} spacing={1}>
                    {index > 0 && <Icon as={FiChevronRight} w={3} h={3} color="gray.400" />}
                    <ChakraLink
                      as={LinkWithRef}
                      to={crumb.path}
                      fontSize="sm"
                      color={index === getBreadcrumbs().length - 1 ? 'brand.500' : 'gray.500'}
                      fontWeight={index === getBreadcrumbs().length - 1 ? 'semibold' : 'normal'}
                      _hover={{ color: 'brand.600' }}
                    >
                      {crumb.name}
                    </ChakraLink>
                  </HStack>
                ))}
              </HStack>
            )}
          </HStack>

          <Spacer />

          {/* System Status Indicators */}
          {!isMobile && (
            <HStack spacing={4} mr={6}>
              <Tooltip label="Camera System Status">
                <HStack spacing={1}>
                  <Icon 
                    as={systemStatus.cameras === 'online' ? FiWifi : FiWifiOff} 
                    w={4} 
                    h={4} 
                    color={systemStatus.cameras === 'online' ? 'green.500' : 'red.500'} 
                  />
                  <Text fontSize="xs" color="gray.500">Cameras</Text>
                </HStack>
              </Tooltip>
              
              <Tooltip label="Database Status">
                <HStack spacing={1}>
                  <Icon 
                    as={FiBattery} 
                    w={4} 
                    h={4} 
                    color={systemStatus.database === 'online' ? 'green.500' : 'red.500'} 
                  />
                  <Text fontSize="xs" color="gray.500">DB</Text>
                </HStack>
              </Tooltip>
              
              <Tooltip label="API Status">
                <HStack spacing={1}>
                  <Icon 
                    as={FiActivity} 
                    w={4} 
                    h={4} 
                    color={systemStatus.api === 'online' ? 'green.500' : 'red.500'} 
                  />
                  <Text fontSize="xs" color="gray.500">API</Text>
                </HStack>
              </Tooltip>
            </HStack>
          )}

          {/* Navigation Links */}
          {user && !isMobile && (
            <HStack spacing={4} mr={6}>
              <ChakraLink 
                as={LinkWithRef} 
                to="/" 
                px={4}
                py={2}
                borderRadius="lg"
                bg={location.pathname === '/' ? 'brand.50' : 'white'}
                color={location.pathname === '/' ? 'brand.600' : textColor}
                boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                border="1px solid"
                borderColor={borderColor}
                _hover={{
                  boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                  transform: 'translateY(-1px)',
                  transition: 'all 0.2s ease'
                }}
                textDecoration="none"
                display="flex"
                alignItems="center"
                gap={2}
              >
                <Icon as={FiHome} w={4} h={4} />
                Home
              </ChakraLink>
              
              {user.role === 'admin' && (
                <ChakraLink 
                  as={LinkWithRef} 
                  to="/admin" 
                  px={4}
                  py={2}
                  borderRadius="lg"
                  bg={location.pathname === '/admin' ? 'purple.50' : 'white'}
                  color={location.pathname === '/admin' ? 'purple.600' : textColor}
                  boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                  border="1px solid"
                  borderColor={borderColor}
                  _hover={{
                    boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                    transform: 'translateY(-1px)',
                    transition: 'all 0.2s ease'
                  }}
                  textDecoration="none"
                  display="flex"
                  alignItems="center"
                  gap={2}
                >
                  <Icon as={FiShield} w={4} h={4} />
                  Admin
                </ChakraLink>
              )}
              
              {user.role === 'guard' && (
                <ChakraLink 
                  as={LinkWithRef} 
                  to="/guard" 
                  px={4}
                  py={2}
                  borderRadius="lg"
                  bg={location.pathname === '/guard' ? 'blue.50' : 'white'}
                  color={location.pathname === '/guard' ? 'blue.600' : textColor}
                  boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                  border="1px solid"
                  borderColor={borderColor}
                  _hover={{
                    boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                    transform: 'translateY(-1px)',
                    transition: 'all 0.2s ease'
                  }}
                  textDecoration="none"
                  display="flex"
                  alignItems="center"
                  gap={2}
                >
                  <Icon as={FiShield} w={4} h={4} />
                  Guard
                </ChakraLink>
              )}
              
              {user.role === 'user' && (
                <ChakraLink 
                  as={LinkWithRef} 
                  to="/user" 
                  px={4}
                  py={2}
                  borderRadius="lg"
                  bg={location.pathname === '/user' ? 'green.50' : 'white'}
                  color={location.pathname === '/user' ? 'green.600' : textColor}
                  boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                  border="1px solid"
                  borderColor={borderColor}
                  _hover={{
                    boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                    transform: 'translateY(-1px)',
                    transition: 'all 0.2s ease'
                  }}
                  textDecoration="none"
                  display="flex"
                  alignItems="center"
                  gap={2}
                >
                  <Icon as={FiUsers} w={4} h={4} />
                  User
                </ChakraLink>
              )}
            </HStack>
          )}

          {/* Notifications */}
          {user && (
            <Menu>
              <MenuButton
                as={IconButton}
                icon={
                  <Box position="relative">
                    <Icon as={FiBell} w={5} h={5} />
                    {unreadNotifications > 0 && (
                      <Badge
                        position="absolute"
                        top="-8px"
                        right="-8px"
                        colorScheme="red"
                        borderRadius="full"
                        fontSize="xs"
                        minW="18px"
                        h="18px"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                      >
                        {unreadNotifications}
                      </Badge>
                    )}
                  </Box>
                }
                variant="neumorphic"
                size="md"
                mr={4}
                _hover={{
                  bg: 'blue.50',
                  color: 'blue.600',
                  boxShadow: '4px 4px 8px #bfdbfe, -4px -4px 8px #ffffff',
                }}
              />
              <MenuList
                boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
                border="1px solid"
                borderColor={borderColor}
                borderRadius="xl"
                maxH="400px"
                overflowY="auto"
              >
                <Box px={4} py={2} borderBottom="1px solid" borderColor={borderColor}>
                  <Text fontWeight="bold" fontSize="sm">Notifications</Text>
                </Box>
                {notifications.length === 0 ? (
                  <Box px={4} py={6} textAlign="center">
                    <Text color="gray.500" fontSize="sm">No notifications</Text>
                  </Box>
                ) : (
                  notifications.map((notification) => (
                    <MenuItem
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification.id)}
                      bg={notification.read ? 'transparent' : 'blue.50'}
                      _hover={{ bg: 'gray.50' }}
                      py={3}
                    >
                      <VStack align="start" spacing={1} w="full">
                        <Text fontSize="sm" fontWeight={notification.read ? 'normal' : 'semibold'}>
                          {notification.message}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                          {notification.time}
                        </Text>
                      </VStack>
                    </MenuItem>
                  ))
                )}
              </MenuList>
            </Menu>
          )}

          {/* User Menu */}
          {user && (
            <Menu>
              <MenuButton
                as={Button}
                variant="neumorphic"
                size="md"
                rightIcon={<Icon as={FiChevronDown} />}
                leftIcon={<Avatar size="sm" name={user.email} bg={`${getRoleColor(user.role)}.500`} />}
                _hover={{
                  bg: 'gray.50',
                  boxShadow: '4px 4px 8px #d1d5db, -4px -4px 8px #ffffff',
                }}
              >
                <VStack spacing={0} align="start">
                  <Text fontSize="sm" fontWeight="semibold">{user.email}</Text>
                  <Badge 
                    colorScheme={getRoleColor(user.role)} 
                    variant="subtle" 
                    fontSize="xs"
                  >
                    {getRoleDisplayName(user.role)}
                  </Badge>
                </VStack>
              </MenuButton>
              <MenuList
                boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
                border="1px solid"
                borderColor={borderColor}
                borderRadius="xl"
              >
                <MenuItem icon={<Icon as={FiUser} />}>
                  Profile
                </MenuItem>
                <MenuItem icon={<Icon as={FiSettings} />}>
                  Settings
                </MenuItem>
                <MenuItem icon={<Icon as={FiHelpCircle} />}>
                  Help & Support
                </MenuItem>
                <MenuDivider />
                <MenuItem icon={<Icon as={FiLogOut} />} onClick={handleLogout} color="red.500">
                  Logout
                </MenuItem>
              </MenuList>
            </Menu>
          )}

          {/* Mobile Menu Button */}
          {user && isMobile && (
            <IconButton
              icon={<Icon as={FiMenu} />}
              variant="neumorphic"
              size="md"
              ml={2}
              onClick={onOpen}
              aria-label="Open menu"
              _hover={{
                bg: 'gray.50',
                boxShadow: '4px 4px 8px #d1d5db, -4px -4px 8px #ffffff',
              }}
            />
          )}
        </Flex>
      </Box>

      {/* Mobile Drawer */}
      <Drawer isOpen={isOpen} placement="right" onClose={onClose}>
        <DrawerOverlay />
        <DrawerContent
          boxShadow="-12px 0 24px #d1d5db"
          borderLeft="1px solid"
          borderColor={borderColor}
        >
          <DrawerCloseButton />
          <DrawerHeader borderBottom="1px solid" borderColor={borderColor}>
            Menu
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4} align="stretch">
              <ChakraLink 
                as={LinkWithRef} 
                to="/" 
                p={4}
                borderRadius="lg"
                bg={location.pathname === '/' ? 'brand.50' : 'white'}
                color={location.pathname === '/' ? 'brand.600' : textColor}
                boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                border="1px solid"
                borderColor={borderColor}
                _hover={{
                  boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                }}
                textDecoration="none"
                display="flex"
                alignItems="center"
                gap={3}
                onClick={onClose}
              >
                <Icon as={FiHome} w={5} h={5} />
                Home
              </ChakraLink>
              
              {user?.role === 'admin' && (
                <ChakraLink 
                  as={LinkWithRef} 
                  to="/admin" 
                  p={4}
                  borderRadius="lg"
                  bg={location.pathname === '/admin' ? 'purple.50' : 'white'}
                  color={location.pathname === '/admin' ? 'purple.600' : textColor}
                  boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                  border="1px solid"
                  borderColor={borderColor}
                  _hover={{
                    boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                  }}
                  textDecoration="none"
                  display="flex"
                  alignItems="center"
                  gap={3}
                  onClick={onClose}
                >
                  <Icon as={FiShield} w={5} h={5} />
                  Admin Dashboard
                </ChakraLink>
              )}
              
              {user?.role === 'guard' && (
                <ChakraLink 
                  as={LinkWithRef} 
                  to="/guard" 
                  p={4}
                  borderRadius="lg"
                  bg={location.pathname === '/guard' ? 'blue.50' : 'white'}
                  color={location.pathname === '/guard' ? 'blue.600' : textColor}
                  boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                  border="1px solid"
                  borderColor={borderColor}
                  _hover={{
                    boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                  }}
                  textDecoration="none"
                  display="flex"
                  alignItems="center"
                  gap={3}
                  onClick={onClose}
                >
                  <Icon as={FiShield} w={5} h={5} />
                  Guard Dashboard
                </ChakraLink>
              )}
              
              {user?.role === 'user' && (
                <ChakraLink 
                  as={LinkWithRef} 
                  to="/user" 
                  p={4}
                  borderRadius="lg"
                  bg={location.pathname === '/user' ? 'green.50' : 'white'}
                  color={location.pathname === '/user' ? 'green.600' : textColor}
                  boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                  border="1px solid"
                  borderColor={borderColor}
                  _hover={{
                    boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                  }}
                  textDecoration="none"
                  display="flex"
                  alignItems="center"
                  gap={3}
                  onClick={onClose}
                >
                  <Icon as={FiUsers} w={5} h={5} />
                  User Portal
                </ChakraLink>
              )}
              
              <Divider />
              
              <Button
                variant="neumorphic"
                colorScheme="red"
                leftIcon={<Icon as={FiLogOut} />}
                onClick={() => {
                  onClose();
                  handleLogout();
                }}
                _hover={{
                  bg: 'red.50',
                  color: 'red.600',
                  boxShadow: '6px 6px 12px #fecaca, -6px -6px 12px #ffffff',
                }}
              >
                Logout
              </Button>
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default Navbar; 