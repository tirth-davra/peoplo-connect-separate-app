import { supabase, UserProfile, AuthResponse } from '../lib/supabase';
import { generateSessionCode } from '../utils/sessionCode';

// Types
interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  success: boolean;
  message: string;
  data: {
    user: UserProfile;
    session: any;
    sessionCode: number;
  };
}

// Auth API functions using Supabase
export const login = async (userData: LoginRequest): Promise<LoginResponse> => {
  try {
    // Sign in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: userData.email,
      password: userData.password,
    });

    if (authError) {
      throw new Error(authError.message);
    }

    if (!authData.user) {
      throw new Error("Login failed - no user data returned");
    }

    // Get user profile from user_profiles table
    let profileData;
    const { data: existingProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      // If user profile doesn't exist, create it
      if (profileError.code === 'PGRST116') {
        const { data: newProfile, error: createError } = await supabase
          .from('user_profiles')
          .insert({
            id: authData.user.id,
            email: authData.user.email || '',
            first_name: authData.user.user_metadata?.first_name || '',
            last_name: authData.user.user_metadata?.last_name || '',
            email_verified: authData.user.email_confirmed_at ? true : false,
            email_verified_at: authData.user.email_confirmed_at || null,
          })
          .select()
          .single();

        if (createError) {
          throw new Error("Failed to create user profile");
        }
        
        profileData = newProfile;
      } else {
        throw new Error("Failed to fetch user profile");
      }
    } else {
      profileData = existingProfile;
    }

    // Generate session code
    const sessionCode = await generateSessionCode();

    // Update user profile with session code
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ session_id: sessionCode })
      .eq('id', authData.user.id);

    if (updateError) {
      throw new Error("Failed to update session code");
    }

    // Fetch the updated user profile with the new session code
    const { data: updatedProfile, error: fetchError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (fetchError) {
      throw new Error("Failed to fetch updated user profile");
    }

    return {
      success: true,
      message: "Login successful",
      data: {
        user: updatedProfile,
        session: authData.session,
        sessionCode,
      },
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

// Sign out function
export const logout = async (): Promise<void> => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    throw new Error(error.message);
  }
};

// Get current user
export const getCurrentUser = async (): Promise<UserProfile | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return null;
    }

    const { data: profileData, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      // If user profile doesn't exist, create it
      if (error.code === 'PGRST116') {
        const { data: newProfile, error: createError } = await supabase
          .from('user_profiles')
          .insert({
            id: user.id,
            email: user.email || '',
            first_name: user.user_metadata?.first_name || '',
            last_name: user.user_metadata?.last_name || '',
            email_verified: user.email_confirmed_at ? true : false,
            email_verified_at: user.email_confirmed_at || null,
          })
          .select()
          .single();

        if (createError) {
          console.error('Error creating user profile:', createError);
          return null;
        }
        
        return newProfile;
      } else {
        console.error('Error fetching user profile:', error);
        return null;
      }
    }

    return profileData;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};
