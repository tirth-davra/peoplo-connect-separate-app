import { supabase, RecentSession, UserProfile } from "../lib/supabase";
import API from "./baseAPI";

// Test Supabase connection
export const testSupabaseConnection = async () => {
  try {
    console.log("🧪 Testing Supabase connection...");
    
    // Check if environment variables are set
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      throw new Error("Supabase environment variables not set");
    }
    
    console.log("✅ Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log("✅ Supabase Key:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "Set" : "Not set");
    
    // Test authentication
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error) {
      console.error("❌ Supabase auth error:", error);
      return { success: false, error: error.message };
    }
    
    if (!user) {
      console.log("ℹ️ No authenticated user (expected if not logged in)");
      return { success: true, message: "Supabase connected, no user authenticated" };
    }
    
    console.log("✅ Supabase connected, user authenticated:", user.id);
    return { success: true, message: "Supabase connected and user authenticated", user };
    
  } catch (error) {
    console.error("❌ Supabase connection test failed:", error);
    return { success: false, error: error.message };
  }
};

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
    console.log("🔄 Adding recent session:", session_id);
    
    // Validate session_id format (10 digits)
    if (!/^\d{10}$/.test(session_id)) {
      console.error("❌ Invalid session ID format:", session_id);
      throw new Error("Session ID must be exactly 10 digits");
    }

    const sessionIdNumber = parseInt(session_id, 10);
    console.log("📝 Parsed session ID:", sessionIdNumber);

    // Use provided userId or try to get from Supabase
    let user;
    if (userId) {
      console.log("✅ Using provided user ID:", userId);
      user = { id: userId };
    } else {
      console.log("🧪 Testing Supabase client...");
      console.log("🧪 Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
      console.log("🧪 Supabase Key exists:", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

      // Get current user with better error handling
      console.log("🔐 Attempting to get current user from Supabase...");
      
      // Try to get user with a shorter timeout and better error handling
      let userError;
      try {
        const authResult = await Promise.race([
          supabase.auth.getUser(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Auth timeout")), 5000)
          )
        ]);
        
        user = authResult.data.user;
        userError = authResult.error;
      } catch (timeoutError) {
        console.error("❌ Authentication call timed out:", timeoutError);
        // Try alternative approach - get session instead
        console.log("🔄 Trying alternative: getSession()...");
        try {
          const sessionResult = await supabase.auth.getSession();
          user = sessionResult.data.session?.user || null;
          userError = sessionResult.error;
          console.log("🔄 Session result:", { user: user ? "exists" : "null", error: userError });
        } catch (sessionError) {
          console.error("❌ Session call also failed:", sessionError);
          throw new Error("Both getUser() and getSession() failed");
        }
      }
      
      console.log("🔐 Supabase auth response:", { user: user ? "exists" : "null", error: userError });
      
      if (userError) {
        console.error("❌ Error getting user:", userError);
        throw new Error(`Authentication error: ${userError.message}`);
      }
      
      if (!user) {
        console.error("❌ No authenticated user found");
        throw new Error("User not authenticated");
      }
    }

    console.log("✅ User authenticated:", user.id);

    // Check if this session already exists for this user
    const { data: existingSession, error: checkError } = await supabase
      .from("recent_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("session_id", sessionIdNumber)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is expected for new sessions
      console.error("❌ Error checking existing session:", checkError);
      throw new Error(`Database error: ${checkError.message}`);
    }

    if (existingSession && !checkError) {
      console.log("ℹ️ Session already exists in recent sessions");
      // Update the timestamp to move it to the top
      const { data: updatedSession, error: updateError } = await supabase
        .from("recent_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", existingSession.id)
        .select()
        .single();

      if (updateError) {
        console.error("❌ Error updating existing session:", updateError);
        throw new Error(`Update error: ${updateError.message}`);
      }

      return {
        success: true,
        message: "Session already exists in recent sessions (updated timestamp)",
        data: updatedSession || existingSession,
      };
    }

    console.log("➕ Creating new recent session...");

    // Create new session
    const { data: newSession, error: insertError } = await supabase
      .from("recent_sessions")
      .insert({
        user_id: user.id,
        session_id: sessionIdNumber,
      })
      .select()
      .single();

    if (insertError) {
      console.error("❌ Error inserting new session:", insertError);
      throw new Error(`Insert error: ${insertError.message}`);
    }

    console.log("✅ Recent session added successfully:", newSession);

    return {
      success: true,
      message: "Recent session added",
      data: newSession,
    };
  } catch (error) {
    console.error("❌ addRecentSession error:", error);
    console.error("❌ Error stack:", error.stack);
    console.error("❌ Error details:", {
      message: error.message,
      name: error.name,
      cause: error.cause
    });
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
