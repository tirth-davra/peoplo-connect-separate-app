// Token monitoring utility for handling page visibility changes and user activity
import { storage } from './storage';
import { isTokenExpired } from './jwtUtils';

/**
 * Set up token monitoring for page visibility changes
 * This ensures tokens are validated when user returns to the app
 */
export const setupTokenVisibilityMonitoring = (onTokenExpired: () => void) => {
  if (typeof window === 'undefined') return;

  const handleVisibilityChange = () => {
    if (!document.hidden) {
      // Page became visible, check token validity
      const token = storage.getToken();
      if (token && isTokenExpired(token)) {
        console.log('Token expired while app was hidden, triggering logout');
        onTokenExpired();
      }
    }
  };

  // Listen for page visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Listen for window focus events (when user returns to the app)
  const handleWindowFocus = () => {
    const token = storage.getToken();
    if (token && isTokenExpired(token)) {
      console.log('Token expired when window gained focus, triggering logout');
      onTokenExpired();
    }
  };

  window.addEventListener('focus', handleWindowFocus);

  // Return cleanup function
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleWindowFocus);
  };
};

/**
 * Set up periodic token validation with user activity detection
 * More frequent checks when user is active, less frequent when idle
 */
export const setupSmartTokenValidation = (onTokenExpired: () => void) => {
  if (typeof window === 'undefined') return;

  let validationInterval: NodeJS.Timeout;
  let lastActivityTime = Date.now();
  let isIdle = false;

  // User activity detection
  const resetActivityTimer = () => {
    lastActivityTime = Date.now();
    if (isIdle) {
      isIdle = false;
      // Switch to active mode: check every 30 seconds
      clearInterval(validationInterval);
      validationInterval = setInterval(() => {
        const token = storage.getToken();
        if (token && isTokenExpired(token)) {
          console.log('Active mode: Token expired, triggering logout');
          onTokenExpired();
          clearInterval(validationInterval);
        }
      }, 30000); // 30 seconds
    }
  };

  // Set up activity listeners
  const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  activityEvents.forEach(event => {
    document.addEventListener(event, resetActivityTimer, true);
  });

  // Start with active mode (30 second intervals)
  validationInterval = setInterval(() => {
    const token = storage.getToken();
    if (token && isTokenExpired(token)) {
      console.log('Active mode: Token expired, triggering logout');
      onTokenExpired();
      clearInterval(validationInterval);
    }
  }, 30000);

  // Switch to idle mode after 5 minutes of inactivity
  const idleCheckInterval = setInterval(() => {
    const timeSinceLastActivity = Date.now() - lastActivityTime;
    if (timeSinceLastActivity > 5 * 60 * 1000 && !isIdle) { // 5 minutes
      isIdle = true;
      // Switch to idle mode: check every 2 minutes
      clearInterval(validationInterval);
      validationInterval = setInterval(() => {
        const token = storage.getToken();
        if (token && isTokenExpired(token)) {
          console.log('Idle mode: Token expired, triggering logout');
          onTokenExpired();
          clearInterval(validationInterval);
        }
      }, 120000); // 2 minutes
    }
  }, 60000); // Check for idle every minute

  // Return cleanup function
  return () => {
    clearInterval(validationInterval);
    clearInterval(idleCheckInterval);
    activityEvents.forEach(event => {
      document.removeEventListener(event, resetActivityTimer, true);
    });
  };
};
