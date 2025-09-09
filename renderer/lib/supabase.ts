import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types
export interface UserProfile {
  id: string // UUID
  email: string
  first_name: string
  last_name: string
  session_id?: number // BIGINT - 10-digit session code
  email_verified: boolean
  email_verified_at?: string
  created_at: string
  updated_at: string
}

export interface RecentSession {
  id: string // UUID
  user_id: string // UUID foreign key
  session_id: number // BIGINT - 10-digit session code
  created_at: string
  updated_at: string
}

// Auth types
export interface AuthUser {
  id: string
  email?: string
  user_metadata?: {
    first_name?: string
    last_name?: string
  }
}

export interface AuthResponse {
  user: AuthUser | null
  session: any | null
  error: any | null
}
