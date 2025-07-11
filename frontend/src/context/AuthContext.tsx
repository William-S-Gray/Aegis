import { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface User {
  _id: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Demo credentials for testing
const DEMO_USERS = {
  'admin@aegis.com': { password: 'admin123', role: 'admin', _id: '507f1f77bcf86cd799439011' },
  'guard@aegis.com': { password: 'guard123', role: 'guard', _id: '507f1f77bcf86cd799439012' },
  'user@aegis.com': { password: 'user123', role: 'user', _id: '507f1f77bcf86cd799439013' },
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  const login = async (email: string, password: string) => {
    // Mock login with demo credentials
    const demoUser = DEMO_USERS[email as keyof typeof DEMO_USERS];
    
    if (demoUser && demoUser.password === password) {
      const userData = { 
        _id: demoUser._id, 
        email, 
        role: demoUser.role 
      };
      setUser(userData);
      // Store user data in localStorage
      localStorage.setItem('user', JSON.stringify(userData));
    } else {
      // Fallback: accept any credentials and assign admin role
      const userData = { _id: '507f1f77bcf86cd799439011', email, role: 'admin' };
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
    }
  };

  const logout = useCallback(() => {
    setUser(null);
    // Clear any stored tokens or user data
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  }, []);

  // Check for stored user data on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        setUser(userData);
      } catch (error) {
        localStorage.removeItem('user');
      }
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}; 