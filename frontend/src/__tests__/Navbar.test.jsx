import React from 'react';
import { render, screen } from '@testing-library/react';
import Navbar from '../components/Navbar';
import { AuthProvider } from '../context/AuthContext';
import { BrowserRouter } from 'react-router-dom';

test('renders Navbar with title', () => {
  render(
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    </AuthProvider>
  );
  expect(screen.getByText(/aegis/i)).toBeInTheDocument();
}); 