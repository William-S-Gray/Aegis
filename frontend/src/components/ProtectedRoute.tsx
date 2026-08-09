import { Center, Spinner } from '@chakra-ui/react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactElement;
  /** Roles permitted to view this route. Omit to require only that a user is signed in. */
  roles?: Role[];
}

/**
 * Gates a route on an authenticated session and, optionally, on role.
 *
 * This is a usability boundary, not a security boundary: it only controls what
 * the browser renders. Every endpoint behind these screens must independently
 * authorize the caller's token server-side, because a determined user can edit
 * localStorage and reach any component in the bundle.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, roles }) => {
  const { user, isInitializing } = useAuth();
  const location = useLocation();

  // Avoid bouncing to /login before the stored session has been read.
  if (isInitializing) {
    return (
      <Center minH="60vh">
        <Spinner size="lg" color="brand.500" thickness="3px" label="Checking session" />
      </Center>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};

export default ProtectedRoute;
