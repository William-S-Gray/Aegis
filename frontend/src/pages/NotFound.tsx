import { Box, Button, Heading, Text, VStack } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';

const NotFound: React.FC = () => (
  <Box p={8} maxW="lg" mx="auto">
    <VStack
      align="stretch"
      spacing={4}
      bg="white"
      p={8}
      borderRadius="xl"
      border="1px solid"
      borderColor="gray.200"
      boxShadow="8px 8px 16px #d1d5db, -8px -8px 16px #ffffff"
    >
      <Heading size="md">Page not found</Heading>
      <Text color="gray.600">The page you are looking for does not exist or has moved.</Text>
      <Button as={RouterLink} to="/" alignSelf="flex-start">
        Back to home
      </Button>
    </VStack>
  </Box>
);

export default NotFound;
