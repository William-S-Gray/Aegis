import React from 'react';
import { Box, Heading, Text, Button, Stack, VStack, Icon, useColorModeValue } from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import { Link as RouterLink } from 'react-router-dom';
import { FiShield, FiUsers, FiTruck, FiActivity } from 'react-icons/fi';

const Home: React.FC = () => {
  const { user } = useAuth();
  const bgColor = useColorModeValue('gray.100', 'gray.800');

  const features = [
    {
      icon: FiShield,
      title: 'Secure Access Control',
      description: 'Advanced license plate recognition with real-time security monitoring'
    },
    {
      icon: FiUsers,
      title: 'Multi-Role Management',
      description: 'Comprehensive user management for admins, guards, and regular users'
    },
    {
      icon: FiTruck,
      title: 'Vehicle Registration',
      description: 'Complete vehicle database with owner information and access history'
    },
    {
      icon: FiActivity,
      title: 'Real-time Analytics',
      description: 'Live dashboards with comprehensive reporting and insights'
    }
  ];

  return (
    <Box p={{ base: 6, md: 12 }} bg={bgColor} minH="100vh">
      {/* Hero Section */}
      <VStack spacing={8} textAlign="center" mb={16}>
        <Box
          bg="white"
          p={8}
          borderRadius="2xl"
          border="1px solid"
          borderColor="gray.200"
          maxW="4xl"
          w="full"
        >
          <Heading 
            size="2xl" 
            mb={6}
            bgGradient="linear(to-r, brand.500, brand.600)"
            bgClip="text"
            fontWeight="bold"
          >
            Welcome to Aegis
          </Heading>
          <Text fontSize="xl" color="gray.600" mb={8}>
            Intelligent Vehicle Access Management System
          </Text>
          <Text fontSize="lg" color="gray.500" mb={8}>
            Experience the future of security with our advanced license plate recognition technology, 
            real-time monitoring, and comprehensive access control management.
          </Text>
          
          {!user ? (
            <Button 
              as={RouterLink} 
              to="/login" 
              size="lg"
              variant="neumorphic"
              colorScheme="brand"
              _hover={{
                bg: 'brand.50',
                color: 'brand.600',
              }}
            >
              Get Started
            </Button>
          ) : (
            <Stack direction={{ base: 'column', md: 'row' }} spacing={4} justify="center">
              {user.role === 'admin' && (
                <Button 
                  as={RouterLink} 
                  to="/admin"
                  size="lg"
                  variant="neumorphic"
                  colorScheme="brand"
                  _hover={{
                    bg: 'brand.50',
                    color: 'brand.600',
                  }}
                >
                  Admin Dashboard
                </Button>
              )}
              {user.role === 'guard' && (
                <Button 
                  as={RouterLink} 
                  to="/guard"
                  size="lg"
                  variant="neumorphic"
                  colorScheme="brand"
                  _hover={{
                    bg: 'brand.50',
                    color: 'brand.600',
                  }}
                >
                  Guard Dashboard
                </Button>
              )}
              {user.role === 'user' && (
                <Button 
                  as={RouterLink} 
                  to="/user"
                  size="lg"
                  variant="neumorphic"
                  colorScheme="brand"
                  _hover={{
                    bg: 'brand.50',
                    color: 'brand.600',
                  }}
                >
                  User Portal
                </Button>
              )}
            </Stack>
          )}
        </Box>
      </VStack>

      {/* Features Section */}
      <VStack spacing={12}>
        <Heading 
          size="xl" 
          textAlign="center"
          bgGradient="linear(to-r, brand.500, brand.600)"
          bgClip="text"
          fontWeight="bold"
        >
          Key Features
        </Heading>
        
        <Box
          display="grid"
          gridTemplateColumns={{ base: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }}
          gap={8}
          w="full"
          maxW="7xl"
        >
          {features.map((feature, index) => (
            <Box
              key={index}
              bg="white"
              p={6}
              borderRadius="xl"
              border="1px solid"
              borderColor="gray.200"
              textAlign="center"
            >
              <Box
                w={16}
                h={16}
                mx="auto"
                mb={4}
                borderRadius="xl"
                bg="brand.50"
                display="flex"
                alignItems="center"
                justifyContent="center"
                border="1px solid"
                borderColor="brand.200"
              >
                <Icon as={feature.icon} w={8} h={8} color="brand.500" />
              </Box>
              <Heading size="md" mb={3} color="gray.700">
                {feature.title}
              </Heading>
              <Text color="gray.600" fontSize="sm">
                {feature.description}
              </Text>
            </Box>
          ))}
        </Box>
      </VStack>
    </Box>
  );
};

export default Home; 