/**
 * Custom Supabase client pointing to the production project (ecqpqtirhpumfgbdtvhh).
 * This file replaces the auto-generated client via a Vite alias in vite.config.ts.
 * All imports of '@/integrations/supabase/client' resolve here at build time.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export const SUPABASE_URL = 'https://ecqpqtirhpumfgbdtvhh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjcXBxdGlyaHB1bWZnYmR0dmhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM4NTYsImV4cCI6MjA4NzE4OTg1Nn0.NtJUalyCRUOqnPge_g0DSS2r1aGLwJC1LcrLoYh8F60';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
