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
        bg: 'gray.50',
        color: 'gray.800',
      },
    },
  },
  components: {
    Card: {
      baseStyle: {
        container: {
          bg: 'white',
          borderRadius: 'xl',
          border: '1px solid',
          borderColor: 'gray.200',
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
          bg: 'white',
          color: 'gray.700',
          border: '1px solid',
          borderColor: 'gray.300',
          boxShadow: 'xs',
          _hover: { bg: 'gray.50', borderColor: 'gray.400' },
          _active: { bg: 'gray.100' },
        },
      },
    },
    Input: {
      defaultProps: { focusBorderColor: 'brand.500' },
      variants: { outline: { field: { bg: 'white' } } },
    },
    Select: {
      defaultProps: { focusBorderColor: 'brand.500' },
      variants: { outline: { field: { bg: 'white' } } },
    },
    Textarea: {
      defaultProps: { focusBorderColor: 'brand.500' },
      variants: { outline: { bg: 'white' } },
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
