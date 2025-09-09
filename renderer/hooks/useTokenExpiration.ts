// Custom hook for handling token expiration during user operations
import { useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { storage } from '../utils/storage';
import { isTokenExpired } from '../utils/jwtUtils';

export const useTokenExpiration = () => {
  const { logout } = useAuth();

  // Function to check if current token is valid
  const isCurrentTokenValid = useCallback(() => {
    const token = storage.getToken();
    return token !== null && !isTokenExpired(token);
  }, []);

  // Function to validate token before performing critical operations
  const validateTokenBeforeOperation = useCallback((operationName: string) => {
    if (!isCurrentTokenValid()) {
      console.warn(`Token expired before ${operationName}, redirecting to login`);
      logout();
      return false;
    }
    return true;
  }, [isCurrentTokenValid, logout]);

  // Function to handle token expiration during async operations
  const withTokenValidation = useCallback(async <T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T | null> => {
    if (!validateTokenBeforeOperation(operationName)) {
      return null;
    }

    try {
      const result = await operation();
      
      // Check token validity after operation
      if (!isCurrentTokenValid()) {
        console.warn(`Token expired during ${operationName}, redirecting to login`);
        logout();
        return null;
      }
      
      return result;
    } catch (error) {
      // Check if error is due to token expiration
      if (error.response?.status === 401) {
        console.warn(`Token expired during ${operationName}, redirecting to login`);
        logout();
        return null;
      }
      throw error;
    }
  }, [validateTokenBeforeOperation, isCurrentTokenValid, logout]);

  // Set up listener for token expiration events
  useEffect(() => {
    const handleTokenExpired = () => {
      console.log('Token expiration detected in useTokenExpiration hook');
      logout();
    };

    window.addEventListener('tokenExpired', handleTokenExpired);
    
    return () => {
      window.removeEventListener('tokenExpired', handleTokenExpired);
    };
  }, [logout]);

  return {
    isCurrentTokenValid,
    validateTokenBeforeOperation,
    withTokenValidation,
  };
};
