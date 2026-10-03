import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { Center, ChakraProvider, extendTheme, Spinner } from '@chakra-ui/react';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import Unauthorized from './pages/Unauthorized';
import NotFound from './pages/NotFound';

// Lazy load components
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const GuardDashboard = React.lazy(() => import('./pages/GuardDashboard'));
const AdminAnalytics = React.lazy(() => import('./pages/AdminAnalytics'));
const GuardAlertHistory = React.lazy(() => import('./pages/GuardAlertHistory'));
const ReviewQueue = React.lazy(() => import('./pages/ReviewQueue'));
const UserPortal = React.lazy(() => import('./pages/UserPortal'));
const Login = React.lazy(() => import('./pages/Login'));
const Home = React.lazy(() => import('./pages/Home'));

// Clean, high-contrast theme. Chakra's defaults do most of the work; the
// overrides keep surfaces flat and quiet so verdict colours stand out.
const theme = extendTheme({
  // Follows the device setting until the person picks one (the toggle in the top bar).
  config: { initialColorMode: 'system', useSystemColorMode: false },
  // Colour roles with a light and a dark value. Pages use these names, never
  // raw greys, so dark mode is a property of the theme rather than of each page.
  semanticTokens: {
    colors: {
      'bg.canvas': { default: 'gray.50', _dark: 'gray.900' },
      'bg.surface': { default: 'white', _dark: 'gray.800' },
      'bg.subtle': { default: 'gray.50', _dark: 'gray.900' },
      'bg.muted': { default: 'gray.100', _dark: 'gray.700' },
      'border.default': { default: 'gray.200', _dark: 'gray.600' },
      'text.default': { default: 'gray.800', _dark: 'gray.100' },
      'text.muted': { default: 'gray.600', _dark: 'gray.400' },
      'text.subtle': { default: 'gray.400', _dark: 'gray.500' },
      // Coloured tints (message boxes, icon tiles) and text on them.
      'tint-red': { default: 'red.50', _dark: 'red.900' },
      'ink-red': { default: 'red.700', _dark: 'red.200' },
      'inkstrong-red': { default: 'red.800', _dark: 'red.100' },
      'edge-red': { default: 'red.200', _dark: 'red.700' },
      'tint-green': { default: 'green.50', _dark: 'green.900' },
      'ink-green': { default: 'green.700', _dark: 'green.200' },
      'inkstrong-green': { default: 'green.800', _dark: 'green.100' },
      'edge-green': { default: 'green.200', _dark: 'green.700' },
      'tint-blue': { default: 'blue.50', _dark: 'blue.900' },
      'ink-blue': { default: 'blue.700', _dark: 'blue.200' },
      'inkstrong-blue': { default: 'blue.800', _dark: 'blue.100' },
      'edge-blue': { default: 'blue.200', _dark: 'blue.700' },
      'tint-orange': { default: 'orange.50', _dark: 'orange.900' },
      'ink-orange': { default: 'orange.700', _dark: 'orange.200' },
      'inkstrong-orange': { default: 'orange.800', _dark: 'orange.100' },
      'edge-orange': { default: 'orange.200', _dark: 'orange.700' },
      'tint-purple': { default: 'purple.50', _dark: 'purple.900' },
      'ink-purple': { default: 'purple.700', _dark: 'purple.200' },
      'inkstrong-purple': { default: 'purple.800', _dark: 'purple.100' },
      'edge-purple': { default: 'purple.200', _dark: 'purple.700' },
      'tint-brand': { default: 'brand.50', _dark: 'brand.900' },
      'ink-brand': { default: 'brand.700', _dark: 'brand.200' },
      'inkstrong-brand': { default: 'brand.800', _dark: 'brand.100' },
      'edge-brand': { default: 'brand.200', _dark: 'brand.700' },
      'tint-yellow': { default: 'yellow.50', _dark: 'yellow.900' },
      'ink-yellow': { default: 'yellow.700', _dark: 'yellow.200' },
      'inkstrong-yellow': { default: 'yellow.800', _dark: 'yellow.100' },
      'edge-yellow': { default: 'yellow.200', _dark: 'yellow.700' },
      'tint-teal': { default: 'teal.50', _dark: 'teal.900' },
      'ink-teal': { default: 'teal.700', _dark: 'teal.200' },
      'inkstrong-teal': { default: 'teal.800', _dark: 'teal.100' },
      'edge-teal': { default: 'teal.200', _dark: 'teal.700' },
    },
  },
  fonts: {
    // The system UI font everywhere: nothing to download, native on each device.
    heading: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  },
  colors: {
    brand: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#0ea5e9',
      600: '#0284c7',
      700: '#0369a1',
      800: '#075985',
      900: '#0c4a6e',
    },
    gray: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
    },
  },
  styles: {
    global: {
      body: {
        bg: 'bg.canvas',
        color: 'text.default',
      },
    },
  },
  components: {
    Card: {
      baseStyle: {
        container: {
          bg: 'bg.surface',
          borderRadius: 'xl',
          border: '1px solid',
          borderColor: 'border.default',
          boxShadow: 'sm',
        },
      },
    },
    Button: {
      baseStyle: {
        borderRadius: 'lg',
        fontWeight: 'semibold',
      },
      variants: {
        // Secondary actions: a quiet white button. Coloured `solid` buttons
        // keep Chakra's colours, so Let in / Turn away read at a glance.
        neumorphic: {
          bg: 'bg.surface',
          color: 'text.default',
          border: '1px solid',
          borderColor: 'border.default',
          boxShadow: 'xs',
          _hover: { bg: 'bg.muted' },
          _active: { bg: 'bg.muted' },
        },
      },
    },
    Input: {
      defaultProps: { focusBorderColor: 'brand.500' },
      variants: { outline: { field: { bg: 'bg.surface' } } },
    },
    Select: {
      defaultProps: { focusBorderColor: 'brand.500' },
      variants: { outline: { field: { bg: 'bg.surface' } } },
    },
    Textarea: {
      defaultProps: { focusBorderColor: 'brand.500' },
      variants: { outline: { bg: 'bg.surface' } },
    },
    Badge: {
      baseStyle: {
        borderRadius: 'md',
        px: 2,
        textTransform: 'none',
        fontWeight: 'semibold',
      },
    },
  },
});

const PageFallback = () => (
  <Center minH="60vh">
    <Spinner size="lg" color="brand.500" thickness="3px" label="Loading" />
  </Center>
);

function AppRoutes() {
  const location = useLocation();

  return (
    // Keyed on pathname so navigating away from a crashed screen clears the error.
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminAnalytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/guard"
            element={
              <ProtectedRoute roles={['admin', 'guard']}>
                <GuardDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/alert-history"
            element={
              <ProtectedRoute roles={['admin', 'guard']}>
                <GuardAlertHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/review-queue"
            element={
              <ProtectedRoute roles={['admin', 'guard']}>
                <ReviewQueue />
              </ProtectedRoute>
            }
          />
          <Route
            path="/user"
            element={
              <ProtectedRoute roles={['admin', 'guard', 'user']}>
                <UserPortal />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    // Notifications top-right: at the bottom they covered the gate's Let in / Turn away buttons.
    <ChakraProvider theme={theme} toastOptions={{ defaultOptions: { position: 'top-right', isClosable: true } }}>
      <AuthProvider>
        <Router>
          <Navbar />
          <AppRoutes />
        </Router>
      </AuthProvider>
    </ChakraProvider>
  );
}

export default App;
