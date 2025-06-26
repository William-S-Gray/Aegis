import React, { useState } from 'react';
import {
  Box,
  Heading,
  FormControl,
  FormLabel,
  Input,
  Button,
  VStack,
  Text,
  useToast,
  InputGroup,
  InputRightElement,
  IconButton,
  useColorModeValue,
  HStack,
  Divider,
  Icon
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FiEye, FiEyeOff, FiShield, FiUser, FiLock } from 'react-icons/fi';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const bgColor = useColorModeValue('gray.100', 'gray.800');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      await login(email, password);
      toast({
        title: 'Login successful',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      navigate('/');
    } catch (error) {
      toast({
        title: 'Login failed',
        description: 'Please check your credentials',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const demoCredentials = [
    { role: 'Admin', email: 'admin@aegis.com', password: 'admin123' },
    { role: 'Guard', email: 'guard@aegis.com', password: 'guard123' },
    { role: 'User', email: 'user@aegis.com', password: 'user123' },
  ];

  const fillDemoCredentials = (email: string, password: string) => {
    setEmail(email);
    setPassword(password);
  };

  return (
    <Box 
      minH="100vh" 
      bg={bgColor}
      display="flex"
      alignItems="center"
      justifyContent="center"
      p={4}
    >
      <Box
        bg="white"
        p={8}
        borderRadius="2xl"
        boxShadow="12px 12px 24px #d1d5db, -12px -12px 24px #ffffff"
        border="1px solid"
        borderColor="gray.200"
        w="full"
        maxW="md"
      >
        {/* Header */}
        <VStack spacing={6} mb={8}>
          <Box
            w={20}
            h={20}
            borderRadius="xl"
            bg="brand.50"
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxShadow="inset 4px 4px 8px #bae6fd, inset -4px -4px 8px #ffffff"
            border="1px solid"
            borderColor="brand.200"
          >
            <Icon as={FiShield} w={10} h={10} color="brand.500" />
          </Box>
          
          <VStack spacing={2}>
            <Heading 
              size="lg"
              bgGradient="linear(to-r, brand.500, brand.600)"
              bgClip="text"
              fontWeight="bold"
            >
              Welcome Back
            </Heading>
            <Text color="gray.600" textAlign="center">
              Sign in to access your Aegis dashboard
            </Text>
          </VStack>
        </VStack>

        {/* Login Form */}
        <form onSubmit={handleSubmit}>
          <VStack spacing={6}>
            <FormControl isRequired>
              <FormLabel color="gray.700">
                <HStack spacing={2}>
                  <Icon as={FiUser} color="brand.500" />
                  <Text>Email Address</Text>
                </HStack>
              </FormLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                size="lg"
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
              <FormLabel color="gray.700">
                <HStack spacing={2}>
                  <Icon as={FiLock} color="brand.500" />
                  <Text>Password</Text>
                </HStack>
              </FormLabel>
              <InputGroup size="lg">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  borderRadius="lg"
                  boxShadow="inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff"
                  border="1px solid"
                  borderColor="gray.200"
                  _focus={{
                    boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
                    borderColor: 'brand.400',
                  }}
                />
                <InputRightElement>
                  <IconButton
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    icon={showPassword ? <FiEyeOff /> : <FiEye />}
                    onClick={() => setShowPassword(!showPassword)}
                    variant="ghost"
                    size="sm"
                    color="gray.500"
                    _hover={{ color: 'brand.500' }}
                  />
                </InputRightElement>
              </InputGroup>
            </FormControl>

            <Button
              type="submit"
              colorScheme="brand"
              size="lg"
              w="full"
              variant="neumorphic"
              isLoading={isLoading}
              loadingText="Signing in..."
              _hover={{
                bg: 'brand.50',
                color: 'brand.600',
                boxShadow: '8px 8px 16px #bae6fd, -8px -8px 16px #ffffff',
              }}
            >
              Sign In
            </Button>
          </VStack>
        </form>

        {/* Demo Credentials */}
        <VStack spacing={4} mt={8}>
          <Divider />
          <Text fontSize="sm" color="gray.600" fontWeight="medium">
            Demo Credentials
          </Text>
          <VStack spacing={2} w="full">
            {demoCredentials.map((cred, index) => (
              <Button
                key={index}
                size="sm"
                variant="ghost"
                w="full"
                onClick={() => fillDemoCredentials(cred.email, cred.password)}
                borderRadius="lg"
                boxShadow="2px 2px 4px #d1d5db, -2px -2px 4px #ffffff"
                border="1px solid"
                borderColor="gray.200"
                _hover={{
                  boxShadow: '4px 4px 8px #cbd5e1, -4px -4px 8px #ffffff',
                  transform: 'translateY(-1px)',
                }}
              >
                <HStack spacing={2} justify="center">
                  <Text fontSize="xs" fontWeight="bold" color="brand.500">
                    {cred.role}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    {cred.email}
                  </Text>
                </HStack>
              </Button>
            ))}
          </VStack>
        </VStack>
      </Box>
    </Box>
  );
};

export default Login; 