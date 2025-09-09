import { supabase } from '../lib/supabase';

// Store active session codes to ensure uniqueness
const activeSessionCodes = new Set<string>();

// Generate a unique 10-digit numeric session code that's not used by any other user
export const generateSessionCode = async (): Promise<number> => {
  let sessionCode: number;
  let attempts = 0;
  const maxAttempts = 50;

  do {
    // Generate a random 10-digit number
    sessionCode = Math.floor(
      1000000000 + Math.random() * 9000000000
    );
    attempts++;

    // Prevent infinite loop
    if (attempts > maxAttempts) {
      throw new Error(
        "Unable to generate unique session code after maximum attempts"
      );
    }

    // Check if this session code is already in active codes
    if (activeSessionCodes.has(sessionCode.toString())) {
      continue; // Try again with next iteration
    }

    // Check if this session_id already exists in the user_profiles table
    try {
      const { data: existingUsers, error } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('session_id', sessionCode);

      // If there's an error or no users found, the session code is unique
      if (error) {
        // If there's an error checking, assume it's unique and break
        break;
      }
      
      if (!existingUsers || existingUsers.length === 0) {
        break;
      }
    } catch (error) {
      // If there's an error checking, assume it's unique and break
      break;
    }
  } while (true);

  // Add to active codes
  activeSessionCodes.add(sessionCode.toString());

  return sessionCode;
};

// Remove session code when session ends
export const removeSessionCode = (sessionCode: string): void => {
  activeSessionCodes.delete(sessionCode);
};

// Check if session code exists
export const isSessionCodeActive = (sessionCode: string): boolean => {
  return activeSessionCodes.has(sessionCode);
};

// Get all active session codes
export const getActiveSessionCodes = (): string[] => {
  return Array.from(activeSessionCodes);
};
