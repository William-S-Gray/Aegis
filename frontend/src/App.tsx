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

// Neumorphism theme
const theme = extendTheme({
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
    }
  },
  styles: {
    global: {
      body: {
        bg: 'gray.100',
        color: 'gray.800',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
    },
  },
  components: {
    Card: {
      baseStyle: {
        container: {
          bg: 'white',
          borderRadius: 'xl',
          boxShadow: '8px 8px 16px #d1d5db, -8px -8px 16px #ffffff',
          border: '1px solid',
          borderColor: 'gray.200',
          _hover: {
            boxShadow: '12px 12px 20px #cbd5e1, -12px -12px 20px #ffffff',
            transform: 'translateY(-2px)',
            transition: 'all 0.3s ease',
          },
        },
      },
    },
    Button: {
      baseStyle: {
        borderRadius: 'lg',
        fontWeight: 'semibold',
        _focus: {
          boxShadow: 'inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff',
        },
      },
      variants: {
        solid: {
          bg: 'white',
          color: 'gray.700',
          boxShadow: '4px 4px 8px #d1d5db, -4px -4px 8px #ffffff',
          border: '1px solid',
          borderColor: 'gray.200',
          _hover: {
            bg: 'gray.50',
            boxShadow: '6px 6px 12px #cbd5e1, -6px -6px 12px #ffffff',
            transform: 'translateY(-1px)',
          },
          _active: {
            boxShadow: 'inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff',
            transform: 'translateY(0px)',
          },
        },
        neumorphic: {
          bg: 'white',
          color: 'gray.700',
          boxShadow: '6px 6px 12px #d1d5db, -6px -6px 12px #ffffff',
          border: '1px solid',
          borderColor: 'gray.200',
          _hover: {
            boxShadow: '8px 8px 16px #cbd5e1, -8px -8px 16px #ffffff',
            transform: 'translateY(-2px)',
          },
          _active: {
            boxShadow: 'inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff',
            transform: 'translateY(0px)',
          },
        },
      },
    },
    Input: {
      baseStyle: {
        field: {
          bg: 'white',
          borderRadius: 'lg',
          boxShadow: 'inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff',
          border: '1px solid',
          borderColor: 'gray.200',
          _focus: {
            boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
            borderColor: 'brand.400',
          },
        },
      },
    },
    Select: {
      baseStyle: {
        field: {
          bg: 'white',
          borderRadius: 'lg',
          boxShadow: 'inset 4px 4px 8px #d1d5db, inset -4px -4px 8px #ffffff',
          border: '1px solid',
          borderColor: 'gray.200',
          _focus: {
            boxShadow: 'inset 6px 6px 12px #cbd5e1, inset -6px -6px 12px #ffffff',
            borderColor: 'brand.400',
          },
        },
      },
    },
    Modal: {
      baseStyle: {
        dialog: {
          bg: 'white',
          borderRadius: 'xl',
          boxShadow: '12px 12px 24px #d1d5db, -12px -12px 24px #ffffff',
          border: '1px solid',
          borderColor: 'gray.200',
        },
      },
    },
    Badge: {
      baseStyle: {
        borderRadius: 'full',
        boxShadow: '2px 2px 4px #d1d5db, -2px -2px 4px #ffffff',
        border: '1px solid',
        borderColor: 'gray.200',
      },
    },
    Stat: {
      baseStyle: {
        container: {
          bg: 'white',
          borderRadius: 'xl',
          p: 4,
          boxShadow: '6px 6px 12px #d1d5db, -6px -6px 12px #ffffff',
          border: '1px solid',
          borderColor: 'gray.200',
        },
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
    <ChakraProvider theme={theme}>
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
