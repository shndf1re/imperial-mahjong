import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface UserProfile {
  id: string;
  username: string;
  is_guest: boolean;
  rank_points: number;
  rank_tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond' | 'Master';
  matches_played: number;
  wins: number;
}