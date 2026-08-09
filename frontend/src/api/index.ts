import axios from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the bearer token to every outgoing request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    /*
     * A single-page-app host answers unknown paths with index.html and HTTP 200.
     * Without this guard that HTML string flows into components as if it were
     * data — which is exactly how the analytics page used to white-screen
     * ("data.map is not a function" inside recharts). Treat it as an error.
     */
    const contentType = String(response.headers?.['content-type'] ?? '');
    if (contentType.includes('text/html')) {
      return Promise.reject(
        new Error(
          `Expected JSON from ${response.config?.url ?? 'the API'} but received HTML. ` +
            'The API base URL is probably misconfigured or the backend is not running.'
        )
      );
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Preserve where the user was so they can be returned after signing in.
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
