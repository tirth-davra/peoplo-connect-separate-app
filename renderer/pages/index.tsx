import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { storage } from '../utils/storage'
import { isTokenExpired } from '../utils/jwtUtils'

export default function IndexPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading, logout } = useAuth()

  useEffect(() => {
    // Check for token expiration on page load
    const checkTokenValidity = () => {
      const token = storage.getToken();
      if (token && isTokenExpired(token)) {
        console.log('Token expired on index page, clearing auth and redirecting to login');
        storage.clearAuth();
        router.replace('/login');
        return;
      }
    };

    // Check immediately
    checkTokenValidity();

    // Set up listener for token expiration events
    const handleTokenExpired = () => {
      console.log('Token expiration event received on index page');
      router.replace('/login');
    };

    window.addEventListener('tokenExpired', handleTokenExpired);

    // Handle routing based on authentication status
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace('/unified')
      } else {
        router.replace('/login')
      }
    }

    return () => {
      window.removeEventListener('tokenExpired', handleTokenExpired);
    };
  }, [isAuthenticated, isLoading, router, logout])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="loading-spinner h-16 w-16 mx-auto mb-6"></div>
        <div className="space-y-2">
          <p className="text-xl font-semibold text-gradient-hero">Loading...</p>
          <p className="text-gray-600 dark:text-gray-400">Initializing DeskViewer</p>
        </div>
      </div>
    </div>
  )
} 