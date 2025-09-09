import axios from "axios";
import { storage } from "../utils/storage";
import { isTokenExpired } from "../utils/jwtUtils";

const API_URL = `${process.env.NEXT_PUBLIC_API_URL}/api`;

// Function to retrieve the access token
const getToken = () => {
  return storage.getToken();
};

// Function to handle token expiration
const handleTokenExpiration = () => {
  console.log('Token expired, clearing authentication data');
  storage.clearAuth();
  
  // Dispatch a custom event to notify the app about token expiration
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tokenExpired'));
  }
};

// Create an Axios instance
const axiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 60000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

axiosInstance.interceptors.request.use(
  async (config) => {
    try {
      const token = getToken();
      if (token) {
        // Check if token is expired before making the request
        if (isTokenExpired(token)) {
          handleTokenExpiration();
          return Promise.reject(new Error('Token expired'));
        }
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    } catch (error) {
      return Promise.reject(error);
    }
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle token expiration errors
axiosInstance.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle 401 Unauthorized errors (token expired/invalid)
    if (error.response?.status === 401) {
      console.log('Received 401 response, token may be expired');
      handleTokenExpiration();
    }
    
    // Handle network errors or other issues
    if (error.code === 'ECONNABORTED' || error.message === 'Network Error') {
      console.log('Network error occurred');
    }
    
    return Promise.reject(error);
  }
);

export default axiosInstance;
