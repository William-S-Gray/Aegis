import { Box, Button, Heading, Text, VStack } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';

const NotFound: React.FC = () => (
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
      <Heading size="md">Page not found</Heading>
      <Text color="text.muted">The page you are looking for does not exist or has moved.</Text>
      <Button as={RouterLink} to="/" alignSelf="flex-start">
        Back to home
      </Button>
    </VStack>
  </Box>
);

export default NotFound;
