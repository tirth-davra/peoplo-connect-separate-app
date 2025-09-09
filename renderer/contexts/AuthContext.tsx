import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useRouter } from "next/router";
import {
  login as loginAPI,
  logout as logoutAPI,
  getCurrentUser,
} from "../api/authAPI";
import { supabase } from "../lib/supabase";
import { storage } from "../utils/storage";

interface User {
  id: string; // UUID
  email: string;
  first_name: string;
  last_name: string;
  session_id?: number; // BIGINT - 10-digit session code
  email_verified: boolean;
  email_verified_at?: string;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  session: any | null;
  sessionCode: number | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [sessionCode, setSessionCode] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      try {
        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();

        if (initialSession) {
          setSession(initialSession);

          // Get user profile
          const userProfile = await getCurrentUser();
          if (userProfile) {
            setUser(userProfile);
            setSessionCode(userProfile.session_id || null);

            // Store in localStorage for persistence
            storage.setUser(userProfile);
            storage.setSessionCode(userProfile.session_id || null);
          }
        } else {
          // Check for stored data as fallback
          const storedUser = storage.getUser();
          const storedSessionCode = storage.getSessionCode();

          if (storedUser && storedSessionCode) {
            setUser(storedUser as User);
            setSessionCode(storedSessionCode);
          }
        }
      } catch (error) {
        console.error("Error getting initial session:", error);
        storage.clearAuth();
      } finally {
        setIsLoading(false);
      }
    };

    getInitialSession();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state changed:", event, session);

      if (event === "SIGNED_IN" && session) {
        setSession(session);

        // Get user profile
        const userProfile = await getCurrentUser();
        if (userProfile) {
          setUser(userProfile);
          setSessionCode(userProfile.session_id || null);

          // Store in localStorage
          storage.setUser(userProfile);
          storage.setSessionCode(userProfile.session_id || null);
        }
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setSession(null);
        setSessionCode(null);
        storage.clearAuth();

        // Redirect to login if not already there
        if (router.pathname !== "/login") {
          router.push("/login");
        }
      } else if (event === "TOKEN_REFRESHED" && session) {
        setSession(session);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await loginAPI({ email, password });

      if (response.success) {
        const userData = response.data.user;
        const sessionData = response.data.session;
        const sessionCodeData = response.data.sessionCode;

        // Update state
        setUser(userData);
        setSession(sessionData);
        setSessionCode(sessionCodeData);

        // Store in localStorage
        storage.setUser(userData);
        storage.setSessionCode(sessionCodeData);

        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  const logout = async () => {
    try {
      // Sign out from Supabase
      await logoutAPI();

      // Clear state
      setUser(null);
      setSession(null);
      setSessionCode(null);

      // Clear stored data
      storage.clearAuth();

      // Redirect to login
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const isAuthenticated = !!user && !!session;

  const value: AuthContextType = {
    user,
    session,
    sessionCode,
    isAuthenticated,
    isLoading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
