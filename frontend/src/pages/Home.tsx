import React from 'react';
import { Box, Button, Container, Heading, Icon, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { FiArrowRight, FiCamera, FiCheckCircle, FiList } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../utils/nav';

// What happens at the gate, in the order it happens.
const STEPS = [
  {
    icon: FiCamera,
    title: 'The camera reads the plate',
    text: 'Every vehicle that arrives at the gate is read automatically.',
  },
  {
    icon: FiList,
    title: 'Aegis checks the register',
    text: 'Registered, visitor, wrong colour or type, or on the watchlist: the guard sees why at a glance.',
  },
  {
    icon: FiCheckCircle,
    title: 'The guard decides',
    text: 'One tap to let in or turn away. Every decision is logged, and uncertain reads go to review.',
  },
];

const Home: React.FC = () => {
  const { user } = useAuth();

  return (
    <Container maxW="5xl" py={{ base: 10, md: 20 }} px={{ base: 4, md: 8 }}>
      <Stack spacing={6} textAlign="center" align="center" mb={{ base: 12, md: 20 }}>
        <Heading as="h1" size="3xl" lineHeight="1.1" maxW="3xl">
          Know every vehicle at your gate
        </Heading>
        <Text fontSize={{ base: 'lg', md: 'xl' }} color="text.muted" maxW="2xl">
          Aegis reads number plates, checks them against your register and watchlist, and puts a
          clear decision in front of the guard.
        </Text>
        <Button
          as={RouterLink}
          to={user ? homeFor(user.role) : '/login'}
          colorScheme="brand"
          size="lg"
          rightIcon={<FiArrowRight />}
        >
          {user ? 'Open your dashboard' : 'Sign in'}
        </Button>
      </Stack>

      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
        {STEPS.map((step, i) => (
          <Box key={step.title} bg="bg.surface" border="1px solid" borderColor="border.default" borderRadius="xl" p={6}>
            <Stack direction="row" align="center" spacing={3} mb={3}>
              <Box bg="tint-brand" color="ink-brand" borderRadius="lg" p={2} display="flex">
                <Icon as={step.icon} w={5} h={5} />
              </Box>
              <Text fontSize="sm" fontWeight="bold" color="text.muted">
                Step {i + 1}
              </Text>
            </Stack>
            <Heading as="h2" size="md" mb={2}>
              {step.title}
            </Heading>
            <Text color="text.muted">{step.text}</Text>
          </Box>
        ))}
      </SimpleGrid>
    </Container>
  );
};

export default Home;
