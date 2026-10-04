import React from 'react';
import { Box, Button, Code, Heading, Text, VStack } from '@chakra-ui/react';

interface Props {
  children: React.ReactNode;
  /** Changing this value clears a previous error, e.g. on route change. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Stops a single failing component from blanking the whole application.
 * Without this, any render-time throw unmounts the React root and the user
 * sees a white screen with no recourse.
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Replace with your error reporting service before going to production.
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Box p={8} maxW="2xl" mx="auto">
        <VStack
          align="stretch"
          spacing={4}
          bg="bg.surface"
          p={8}
          borderRadius="xl"
          border="1px solid"
          borderColor="border.default"
        >
          <Heading size="md" color="red.500">
            Something went wrong on this page
          </Heading>
          <Text color="text.muted">
            The rest of the application is still available. You can retry this screen or head back
            to the dashboard.
          </Text>
          {import.meta.env.DEV && (
            <Code colorScheme="red" p={3} borderRadius="md" whiteSpace="pre-wrap">
              {error.message}
            </Code>
          )}
          <Button alignSelf="flex-start" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </VStack>
      </Box>
    );
  }
}

export default ErrorBoundary;
