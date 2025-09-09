// JWT utility functions for token validation and expiration checking
export interface JWTPayload {
  exp: number;
  iat: number;
  [key: string]: any;
}

/**
 * Decode JWT token without verification (client-side only)
 * @param token JWT token string
 * @returns Decoded payload or null if invalid
 */
export const decodeJWT = (token: string): JWTPayload | null => {
  try {
    // JWT tokens have 3 parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    const decodedPayload = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    
    return JSON.parse(decodedPayload);
  } catch (error) {
    console.error('Error decoding JWT token:', error);
    return null;
  }
};

/**
 * Check if JWT token is expired
 * @param token JWT token string
 * @returns true if token is expired, false otherwise
 */
export const isTokenExpired = (token: string): boolean => {
  try {
    const payload = decodeJWT(token);
    if (!payload || !payload.exp) {
      return true; // Consider invalid tokens as expired
    }

    // exp is in seconds, Date.now() is in milliseconds
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp < currentTime;
  } catch (error) {
    console.error('Error checking token expiration:', error);
    return true; // Consider tokens with errors as expired
  }
};

/**
 * Get time until token expires in milliseconds
 * @param token JWT token string
 * @returns milliseconds until expiration, negative if already expired
 */
export const getTimeUntilExpiry = (token: string): number => {
  try {
    const payload = decodeJWT(token);
    if (!payload || !payload.exp) {
      return -1;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    return (payload.exp - currentTime) * 1000; // Convert to milliseconds
  } catch (error) {
    console.error('Error getting time until expiry:', error);
    return -1;
  }
};

/**
 * Check if token will expire within the next specified time
 * @param token JWT token string
 * @param timeMs time in milliseconds to check ahead
 * @returns true if token expires within the specified time
 */
export const isTokenExpiringSoon = (token: string, timeMs: number = 5 * 60 * 1000): boolean => {
  const timeUntilExpiry = getTimeUntilExpiry(token);
  return timeUntilExpiry > 0 && timeUntilExpiry <= timeMs;
};
