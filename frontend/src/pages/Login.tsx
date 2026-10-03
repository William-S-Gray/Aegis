import React, { useEffect, useState } from 'react';
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
  HStack,
  Divider,
  Icon
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';
import { mockAuthEnabled } from '../config';
import { homeFor } from '../utils/nav';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiEye, FiEyeOff, FiShield, FiUser, FiLock } from 'react-icons/fi';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const bgColor = 'bg.canvas';

  // Signed in (just now, or already): go back to the page that sent them
  // here, else to their own start page rather than the public home page.
  useEffect(() => {
    if (!user) return;
    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
    navigate(from ?? homeFor(user.role), { replace: true });
  }, [user, location.state, navigate]);

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
    } catch (error) {
      const description =
        error instanceof Error && error.message
          ? error.message
          : 'Please check your credentials and try again';
      toast({
        title: 'Login failed',
        description,
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const demoCredentials = [
    { role: 'Admin', email: 'admin@aegis.example', password: 'admin123' },
    { role: 'Guard', email: 'guard@aegis.example', password: 'guard123' },
    { role: 'User', email: 'user@aegis.example', password: 'user123' },
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
        bg="bg.surface"
        p={8}
        borderRadius="2xl"
        border="1px solid"
        borderColor="border.default"
        w="full"
        maxW="md"
      >
        {/* Header */}
        <VStack spacing={6} mb={8}>
          <Box
            w={20}
            h={20}
            borderRadius="xl"
            bg="tint-brand"
            display="flex"
            alignItems="center"
            justifyContent="center"
            border="1px solid"
            borderColor="edge-brand"
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
            <Text color="text.muted" textAlign="center">
              Sign in to access your Aegis dashboard
            </Text>
          </VStack>
        </VStack>

        {/* Login Form */}
        <form onSubmit={handleSubmit}>
          <VStack spacing={6}>
            <FormControl isRequired>
              <FormLabel color="text.default" display="flex" alignItems="center" gap={2}>
                <Icon as={FiUser} color="brand.500" />
                Email
              </FormLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                size="lg"
                borderRadius="lg"
                border="1px solid"
                borderColor="border.default"
                _focus={{
                  borderColor: 'brand.400',
                }}
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel color="text.default" display="flex" alignItems="center" gap={2}>
                <Icon as={FiLock} color="brand.500" />
                Password
              </FormLabel>
              <InputGroup size="lg">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  borderRadius="lg"
                  border="1px solid"
                  borderColor="border.default"
                  _focus={{
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
                    color="text.muted"
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
                bg: 'tint-brand',
                color: 'ink-brand',
              }}
            >
              Sign In
            </Button>
          </VStack>
        </form>

        {/* Demo credentials: only rendered when mock auth is explicitly enabled for local dev. */}
        {mockAuthEnabled && (
        <VStack spacing={4} mt={8}>
          <Divider />
          <Text fontSize="sm" color="text.muted" fontWeight="medium">
            Demo Credentials (development only)
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
                border="1px solid"
                borderColor="border.default"
              >
                <HStack spacing={2} justify="center">
                  <Text fontSize="xs" fontWeight="bold" color="brand.500">
                    {cred.role}
                  </Text>
                  <Text fontSize="xs" color="text.muted">
                    {cred.email}
                  </Text>
                </HStack>
              </Button>
            ))}
          </VStack>
        </VStack>
        )}
      </Box>
    </Box>
  );
};

export default Login; 