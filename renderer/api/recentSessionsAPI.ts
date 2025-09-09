import { supabase, RecentSession, UserProfile } from "../lib/supabase";
import API from "./baseAPI";


// Types
interface AddRecentSessionResponse {
  success: boolean;
  message: string;
  data: RecentSession;
}

interface GetRecentSessionsResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    session_id: number; // Converted from string to number
    first_name?: string;
    last_name?: string;
    isActive?: boolean;
    status?: "online" | "offline";
  }[];
}

interface SessionStatusResponse {
  success: boolean;
  data: {
    sessionId: string;
    isActive: boolean;
    status: "online" | "offline";
  };
}

interface BatchSessionStatusResponse {
  success: boolean;
  data: {
    sessionId: string;
    isActive: boolean;
    status: "online" | "offline";
  }[];
}

interface RemoveRecentSessionResponse {
  success: boolean;
  message: string;
}

// Add a recent session for the current user (with optional user ID parameter)
export const addRecentSession = async (
  session_id: string,
  userId?: string
): Promise<AddRecentSessionResponse> => {
  try {
    // Validate session_id format (10 digits)
    if (!/^\d{10}$/.test(session_id)) {
      throw new Error("Session ID must be exactly 10 digits");
    }

    const sessionIdNumber = parseInt(session_id, 10);

    // Use provided userId or try to get from Supabase
    let user;
    if (userId) {
      user = { id: userId };
    } else {
      // Get current user with better error handling
      let userError;
      try {
        const authResult = await Promise.race([
          supabase.auth.getUser(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Auth timeout")), 5000)
          )
        ]) as any;
        
        user = authResult.data.user;
        userError = authResult.error;
      } catch (timeoutError) {
        // Try alternative approach - get session instead
        try {
          const sessionResult = await supabase.auth.getSession();
          user = sessionResult.data.session?.user || null;
          userError = sessionResult.error;
        } catch (sessionError) {
          throw new Error("Both getUser() and getSession() failed");
        }
      }
      
      if (userError) {
        throw new Error(`Authentication error: ${userError.message}`);
      }
      
      if (!user) {
        throw new Error("User not authenticated");
      }
    }

    // Check if this session already exists for this user
    let existingSession, checkError;
    try {
      const checkResult = await Promise.race([
        supabase
          .from("recent_sessions")
          .select("*")
          .eq("user_id", user.id)
          .eq("session_id", sessionIdNumber)
          .single(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Database query timeout")), 10000)
        )
      ]) as any;
      
      existingSession = checkResult.data;
      checkError = checkResult.error;
    } catch (timeoutError) {
      throw new Error("Database query timeout");
    }

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is expected for new sessions
      throw new Error(`Database error: ${checkError.message}`);
    }

    if (existingSession && !checkError) {
      // Update the timestamp to move it to the top
      const { data: updatedSession, error: updateError } = await supabase
        .from("recent_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", existingSession.id)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Update error: ${updateError.message}`);
      }

      return {
        success: true,
        message: "Session already exists in recent sessions (updated timestamp)",
        data: updatedSession || existingSession,
      };
    }

    // Create new session
    let newSession, insertError;
    try {
      const insertResult = await Promise.race([
        supabase
          .from("recent_sessions")
          .insert({
            user_id: user.id,
            session_id: sessionIdNumber,
          })
          .select()
          .single(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Database insert timeout")), 10000)
        )
      ]) as any;
      
      newSession = insertResult.data;
      insertError = insertResult.error;
    } catch (timeoutError) {
      throw new Error("Database insert timeout");
    }

    if (insertError) {
      throw new Error(`Insert error: ${insertError.message}`);
    }

    return {
      success: true,
      message: "Recent session added",
      data: newSession,
    };
  } catch (error) {
    throw new Error(error.message || "Unknown error occurred");
  }
};

// Get recent sessions for the current user
export const getRecentSessions =
  async (): Promise<GetRecentSessionsResponse> => {
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Get recent sessions for the user
      const { data: recentSessions, error: sessionsError } = await supabase
        .from("recent_sessions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (sessionsError) {
        throw new Error(sessionsError.message);
      }

             if (!recentSessions || recentSessions.length === 0) {
         return {
           success: true,
           message: "Recent sessions retrieved",
           data: [],
         };
       }

       // Get session IDs from recent sessions (these are the sessions we connected to)
       const sessionIds = recentSessions.map((s) => Number(s.session_id));

       // Find users who own these session IDs (the users we connected to)
       const { data: sessionOwners, error: usersError } = await supabase
         .from("user_profiles")
         .select("id, first_name, last_name, session_id")
         .in("session_id", sessionIds);

       if (usersError) {
         throw new Error(usersError.message);
       }

       // Map session_id -> user details for quick lookup
       const sessionIdToOwner = new Map(
         sessionOwners?.map((u) => [
           Number(u.session_id),
           { first_name: u.first_name, last_name: u.last_name },
         ]) || []
       );

       // Show all recent sessions with owner info
       const activeRecentSessions = recentSessions.map((s) => {
         const sessionIdNum = Number(s.session_id);
         const ownerInfo = sessionIdToOwner.get(sessionIdNum);

         return {
           id: s.id,
           session_id: sessionIdNum,
           first_name: ownerInfo?.first_name || "Unknown",
           last_name: ownerInfo?.last_name || "User",
         };
       });

      return {
        success: true,
        message: "Recent sessions retrieved",
        data: activeRecentSessions,
      };
    } catch (error) {
      throw new Error(error.message);
    }
  };

// Remove a recent session
export const removeRecentSession = async (
  session_id: string
): Promise<RemoveRecentSessionResponse> => {
  try {
    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const sessionIdNumber = parseInt(session_id, 10);

    const { error } = await supabase
      .from("recent_sessions")
      .delete()
      .eq("user_id", user.id)
      .eq("session_id", sessionIdNumber);

    if (error) {
      throw new Error(error.message);
    }

    return {
      success: true,
      message: "Recent session removed",
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

// Check if a single session is active (still uses backend API)
export const checkSessionStatus = async (
  sessionId: string
): Promise<SessionStatusResponse> => {
  try {
    const response = await API.get(`/sessions/status/${sessionId}`);
    return response.data;
  } catch (error) {
    throw new Error(error.message);
  }
};

// Check multiple session statuses at once (still uses backend API)
export const checkBatchSessionStatus = async (
  sessionIds: string[]
): Promise<BatchSessionStatusResponse> => {
  try {
    const response = await API.post("/sessions/status/batch", {
      sessionIds,
    });
    return response.data;
  } catch (error) {
    throw new Error(error.message);
  }
};
