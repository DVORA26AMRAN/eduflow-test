import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = 'https://kkafmsvntwqweudallty.supabase.co'
export const supabaseAnonKey = 'sb_publishable_JHfrqd4jZJ7YfLDnDJ6lpQ_sfrgnued'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const PENDING_PASSWORD_SETUP_KEY = 'eduflow_pending_password_setup'
