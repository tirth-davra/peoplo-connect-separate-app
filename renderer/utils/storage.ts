// Storage utility functions using localStorage (works in renderer process)
import { isTokenExpired } from './jwtUtils';

const STORAGE_KEYS = {
  TOKEN: "token",
  USER: "user",
  SESSION_CODE: "sessionCode",
} as const;

// Storage utility functions
export const storage = {
  // Get token
  getToken: (): string | null => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEYS.TOKEN);
  },

  // Set token
  setToken: (token: string): void => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  },

  // Remove token
  removeToken: (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
  },

  // Check if token exists and is valid
  hasValidToken: (): boolean => {
    if (typeof window === "undefined") return false;
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    return token !== null && !isTokenExpired(token);
  },

  // Get user
  getUser: () => {
    if (typeof window === "undefined") return null;
    const user = localStorage.getItem(STORAGE_KEYS.USER);
    return user ? JSON.parse(user) : null;
  },

  // Set user
  setUser: (user: any): void => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  },

  // Remove user
  removeUser: (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEYS.USER);
  },

  // Get session code
  getSessionCode: (): number | null => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(STORAGE_KEYS.SESSION_CODE);
    return stored ? parseInt(stored, 10) : null;
  },

  // Set session code
  setSessionCode: (sessionCode: number | null): void => {
    if (typeof window === "undefined") return;
    if (sessionCode === null) {
      localStorage.removeItem(STORAGE_KEYS.SESSION_CODE);
    } else {
      localStorage.setItem(STORAGE_KEYS.SESSION_CODE, sessionCode.toString());
    }
  },

  // Remove session code
  removeSessionCode: (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEYS.SESSION_CODE);
  },

  // Clear all auth data
  clearAuth: (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.SESSION_CODE);
  },
};
