-- Update user_profiles table to use BIGINT for session_id
ALTER TABLE user_profiles ALTER COLUMN session_id TYPE BIGINT USING session_id::BIGINT;

-- Create recent_sessions table
CREATE TABLE IF NOT EXISTS recent_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  session_id BIGINT NOT NULL CHECK (session_id >= 1000000000 AND session_id <= 9999999999), -- 10-digit session codes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_recent_sessions_user_id ON recent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_recent_sessions_session_id ON recent_sessions(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recent_sessions_user_session ON recent_sessions(user_id, session_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_recent_sessions_updated_at 
  BEFORE UPDATE ON recent_sessions 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE recent_sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see their own recent sessions
CREATE POLICY "Users can view own recent sessions" ON recent_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- Option 1: More permissive policy for user_profiles (recommended)
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
CREATE POLICY "Users can view profiles for recent sessions" ON user_profiles
  FOR SELECT USING (
    auth.uid() = id OR 
    EXISTS (
      SELECT 1 FROM recent_sessions 
      WHERE recent_sessions.user_id = auth.uid() 
      AND recent_sessions.session_id = user_profiles.session_id
    )
  );

-- Option 2: Alternative - Allow viewing all profiles (less secure but simpler)
-- Uncomment the line below if you want to allow all authenticated users to view all profiles
-- CREATE POLICY "Authenticated users can view all profiles" ON user_profiles FOR SELECT USING (auth.role() = 'authenticated');

-- Option 3: Alternative - Disable RLS for user_profiles (least secure)
-- Uncomment the line below if you want to disable RLS completely for user_profiles
-- ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

-- Users can insert their own recent sessions
CREATE POLICY "Users can insert own recent sessions" ON recent_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own recent sessions
CREATE POLICY "Users can update own recent sessions" ON recent_sessions
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own recent sessions
CREATE POLICY "Users can delete own recent sessions" ON recent_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Create a function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, first_name, last_name, email_verified, email_verified_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
    NEW.email_confirmed_at
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create user profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
