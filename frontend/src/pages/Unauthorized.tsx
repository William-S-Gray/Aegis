import { Box, Button, Heading, Text, VStack } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Unauthorized: React.FC = () => {
  const { user } = useAuth();

  return (
    <Box p={8} maxW="lg" mx="auto">
      <VStack
        align="stretch"
        spacing={4}
        bg="bg.surface"
        p={8}
        borderRadius="xl"
        border="1px solid"
        borderColor="border.default"
      >
        <Heading size="md">Access denied</Heading>
        <Text color="text.muted">
          Your account{user ? ` (${user.role})` : ''} does not have permission to view this page. If
          you believe this is a mistake, contact your system administrator.
        </Text>
        <Button as={RouterLink} to="/" alignSelf="flex-start">
          Back to home
        </Button>
      </VStack>
    </Box>
  );
};

export default Unauthorized;
