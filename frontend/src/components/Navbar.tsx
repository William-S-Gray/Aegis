import React, { useEffect, useState } from 'react';
import { 
  Box, Flex, Button, Spacer, Heading, Link as ChakraLink, HStack, VStack, 
  Text, Avatar, Menu, MenuButton, MenuList, MenuItem,
  Badge, IconButton, useDisclosure, Drawer, DrawerBody, DrawerHeader,
  DrawerOverlay, DrawerContent, DrawerCloseButton, useBreakpointValue,
  Divider, Tooltip, useToast, Icon, useColorMode
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { asArray } from '../utils/safe';
import { poll } from '../utils/poll';
import { NAV, homeFor } from '../utils/nav';
import ChangePasswordDialog from './ChangePasswordDialog';
import { API_BASE_URL } from '../config';
import { Link as RouterLink, useNavigate, useLocation } from 'react-router-dom';
import type { LinkProps as RouterLinkProps } from 'react-router-dom';
import {
  FiKey, FiLogOut, FiMenu, FiActivity, FiMoon, FiSun, FiWifi, FiWifiOff, FiBattery, FiChevronDown,
} from 'react-icons/fi';

type Health = 'online' | 'offline' | 'unknown';
const HEALTH_COLOR: Record<Health, string> = { online: 'green.500', offline: 'red.500', unknown: 'gray.400' };
const HEALTH_LABEL: Record<Health, string> = { online: 'online', offline: 'offline', unknown: 'unknown' };

const LinkWithRef = React.forwardRef<HTMLAnchorElement, RouterLinkProps>((props, ref) => (
  <RouterLink ref={ref} {...props} />
));

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const passwordDialog = useDisclosure();
  
  // Responsive design
  const isMobile = useBreakpointValue({ base: true, md: false });
  
  // Theme colors
  const bgColor = 'bg.surface';
  const borderColor = 'border.default';
  const textColor = 'text.default';

  // Live health, polled. Unknown is shown as grey, never as a hopeful green:
  // a guard must not see "online" for a system that is down.
  const [systemStatus, setSystemStatus] = useState<Record<'api' | 'database' | 'cameras', Health>>({
    api: 'unknown',
    database: 'unknown',
    cameras: 'unknown',
  });

  // Queue depth, refreshed periodically. Guards should see work waiting
  // without having to open the page to find out.
  const [reviewCount, setReviewCount] = useState(0);
  const canReview = user?.role === 'admin' || user?.role === 'guard';

  useEffect(() => {
    let cancelled = false;
    const origin = API_BASE_URL.replace(/\/api\/v\d+$/, '');

    const check = async () => {
      let apiHealth: Health = 'offline';
      let database: Health = 'unknown';
      try {
        // /ready answers 503 when the API is up but its database is not.
        const res = await fetch(`${origin}/ready`, { cache: 'no-store' });
        apiHealth = 'online';
        database = res.ok ? 'online' : 'offline';
      } catch {
        // Unreachable: the API is down, and the database cannot be judged.
      }
      let cameras: Health = 'unknown';
      if (canReview && apiHealth === 'online') {
        try {
          const list = asArray<{ online: boolean }>((await api.get('/cameras')).data);
          if (list.length) cameras = list.some(c => c.online) ? 'online' : 'offline';
        } catch {
          // Leave unknown.
        }
      }
      if (!cancelled) setSystemStatus({ api: apiHealth, database, cameras });
    };

    const stop = poll(check, 30000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [canReview]);

  useEffect(() => {
    if (!canReview) {
      setReviewCount(0);
      return;
    }
    let cancelled = false;

    const check = () =>
      api
        .get('/alerts/review-queue')
        .then((res) => {
          if (!cancelled) setReviewCount(asArray(res.data).length);
        })
        .catch(() => {
          // A transient failure should not blank the badge or spam the user.
        });

    const stop = poll(check, 30000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [canReview]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast({
      title: 'Logged out successfully',
      status: 'success',
      duration: 2000,
    });
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'guard': return 'Security Guard';
      case 'user': return 'Resident';
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
            <ChakraLink as={LinkWithRef} to={homeFor(user?.role)} _hover={{ textDecoration: 'none' }}>
              <Heading size="lg" bgGradient="linear(to-r, brand.500, brand.600)" bgClip="text" fontWeight="bold">
                Aegis
              </Heading>
            </ChakraLink>
            
          </HStack>

          <Spacer />

          {/* System Status Indicators */}
          {!isMobile && (
            <HStack spacing={4} mr={6}>
              {canReview && (
              <Tooltip label={`Cameras: ${HEALTH_LABEL[systemStatus.cameras]}`}>
                <HStack spacing={1} aria-label={`Cameras: ${HEALTH_LABEL[systemStatus.cameras]}`}>
                  <Icon 
                    as={systemStatus.cameras === 'offline' ? FiWifiOff : FiWifi} 
                    w={4} 
                    h={4} 
                    color={HEALTH_COLOR[systemStatus.cameras]} 
                  />
                  <Text fontSize="xs" color="text.muted" display={{ base: 'none', '2xl': 'inline' }}>Cameras</Text>
                </HStack>
              </Tooltip>
              )}
              
              <Tooltip label={`Database: ${HEALTH_LABEL[systemStatus.database]}`}>
                <HStack spacing={1} aria-label={`Database: ${HEALTH_LABEL[systemStatus.database]}`}>
                  <Icon 
                    as={FiBattery} 
                    w={4} 
                    h={4} 
                    color={HEALTH_COLOR[systemStatus.database]} 
                  />
                  <Text fontSize="xs" color="text.muted" display={{ base: 'none', '2xl': 'inline' }}>DB</Text>
                </HStack>
              </Tooltip>
              
              <Tooltip label={`API: ${HEALTH_LABEL[systemStatus.api]}`}>
                <HStack spacing={1} aria-label={`API: ${HEALTH_LABEL[systemStatus.api]}`}>
                  <Icon 
                    as={FiActivity} 
                    w={4} 
                    h={4} 
                    color={HEALTH_COLOR[systemStatus.api]} 
                  />
                  <Text fontSize="xs" color="text.muted" display={{ base: 'none', '2xl': 'inline' }}>API</Text>
                </HStack>
              </Tooltip>
            </HStack>
          )}

          {/* Navigation Links */}
          {user && !isMobile && (
            <HStack spacing={1} mr={4} as="nav" aria-label="Main">
              {NAV[user.role].map((item) => {
                const active = location.pathname === item.to;
                return (
                  <ChakraLink
                    key={item.to}
                    as={LinkWithRef}
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    px={3}
                    py={2}
                    borderRadius="md"
                    fontWeight={active ? 'semibold' : 'medium'}
                    bg={active ? 'tint-brand' : 'transparent'}
                    color={active ? 'ink-brand' : textColor}
                    _hover={{ bg: 'bg.muted', textDecoration: 'none' }}
                    display="flex"
                    alignItems="center"
                    gap={2}
                    whiteSpace="nowrap"
                  >
                    <Icon as={item.icon} w={4} h={4} />
                    {item.label}
                    {item.to === '/review-queue' && reviewCount > 0 && (
                      <Badge colorScheme="orange" borderRadius="full" px={2}>
                        {reviewCount}
                      </Badge>
                    )}
                  </ChakraLink>
                );
              })}
            </HStack>
          )}

          <Tooltip label={colorMode === 'dark' ? 'Light mode' : 'Dark mode'}>
            <IconButton
              aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              icon={<Icon as={colorMode === 'dark' ? FiSun : FiMoon} />}
              variant="ghost"
              mr={2}
              onClick={toggleColorMode}
            />
          </Tooltip>

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
                  bg: 'bg.muted',
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
                border="1px solid"
                borderColor={borderColor}
                borderRadius="xl"
              >
                <MenuItem icon={<Icon as={FiKey} />} onClick={passwordDialog.onOpen}>
                  Change password
                </MenuItem>
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
                bg: 'bg.muted',
              }}
            />
          )}
        </Flex>
      </Box>

      <ChangePasswordDialog isOpen={passwordDialog.isOpen} onClose={passwordDialog.onClose} />

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
            <VStack spacing={2} align="stretch" as="nav" aria-label="Main">
              {user &&
                NAV[user.role].map((item) => {
                  const active = location.pathname === item.to;
                  return (
                    <ChakraLink
                      key={item.to}
                      as={LinkWithRef}
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      p={4}
                      borderRadius="lg"
                      fontWeight={active ? 'semibold' : 'medium'}
                      bg={active ? 'tint-brand' : 'transparent'}
                      color={active ? 'ink-brand' : textColor}
                      _hover={{ bg: 'bg.muted', textDecoration: 'none' }}
                      display="flex"
                      alignItems="center"
                      gap={3}
                      onClick={onClose}
                    >
                      <Icon as={item.icon} w={5} h={5} />
                      {item.label}
                      {item.to === '/review-queue' && reviewCount > 0 && (
                        <Badge colorScheme="orange" borderRadius="full" px={2} ml="auto">
                          {reviewCount}
                        </Badge>
                      )}
                    </ChakraLink>
                  );
                })}
              
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
                  bg: 'tint-red',
                  color: 'ink-red',
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