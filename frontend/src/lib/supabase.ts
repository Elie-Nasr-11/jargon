import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://qztpieiizmiayzjhezwh.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dHBpZWlpem1pYXl6amhlendoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NzE1NDEsImV4cCI6MjA4NjA0NzU0MX0.GhO5RAffyZnCTT5je9xUuIFyltHFvEvh2vuWJmsB_wk";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function functionUrl(
  slug:
    | "chat"
    | "run"
    | "admin-seed"
    | "admin-ops"
    | "curriculum-admin"
    | "voice-session"
    | "resource-processing"
    | "google-classroom",
) {
  return `${supabaseUrl}/functions/v1/${slug}`;
}
