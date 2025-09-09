import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { storage } from '../utils/storage'
import { isTokenExpired } from '../utils/jwtUtils'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading, logout } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Check for token expiration
    const checkTokenValidity = () => {
      const token = storage.getToken();
      if (token && isTokenExpired(token)) {
        console.log('Token expired in ProtectedRoute, redirecting to login');
        storage.clearAuth();
        router.push('/login');
        return;
      }
    };

    // Check immediately
    checkTokenValidity();

    // Set up listener for token expiration events
    const handleTokenExpired = () => {
      console.log('Token expiration event received in ProtectedRoute');
      router.push('/login');
    };

    window.addEventListener('tokenExpired', handleTokenExpired);

    // Handle authentication status
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
    }

    return () => {
      window.removeEventListener('tokenExpired', handleTokenExpired);
    };
  }, [isAuthenticated, isLoading, router, logout])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="loading-spinner h-16 w-16 mx-auto mb-6"></div>
          <div className="space-y-2">
            <p className="text-xl font-semibold text-gradient-hero">Loading...</p>
            <p className="text-gray-600 dark:text-gray-400">Preparing your remote desktop experience</p>
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null // Will redirect to login
  }

  return <>{children}</>
} 