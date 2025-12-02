import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  
  return parts[1];
}

/**
 * Creates a Supabase admin client using SERVICE_ROLE key
 * This bypasses RLS and should only be used for server-side operations
 */
export function createAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    }
  });
}

/**
 * Creates a Supabase client that acts as the authenticated user
 * Uses the user's JWT token for RLS enforcement
 */
export function createUserClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader) {
    throw new AuthError('Missing Authorization header', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }

  return createClient(supabaseUrl, supabaseAnonKey, { 
    global: { 
      headers: { Authorization: authHeader } 
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    }
  });
}

/**
 * Verifies JWT token and returns the authenticated user
 * Uses SERVICE_ROLE to validate the token server-side
 */
export async function verifyAndGetUser(req: Request): Promise<{ user: User; supabase: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  const token = extractBearerToken(authHeader);
  
  if (!token) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  // Use admin client to verify the token
  const adminClient = createAdminClient();
  
  const { data: { user }, error } = await adminClient.auth.getUser(token);
  
  if (error) {
    console.error('[Auth] Token verification failed:', error.message);
    throw new AuthError('Invalid JWT', 401);
  }
  
  if (!user) {
    throw new AuthError('Invalid JWT - no user found', 401);
  }
  
  // Return admin client for server operations, or create user client for RLS
  return { user, supabase: adminClient };
}

/**
 * Gets the authenticated user using the request's Authorization header
 * This version uses the user's token with RLS enforcement
 */
export async function getAuthenticatedUser(req: Request): Promise<{ user: User; supabase: SupabaseClient }> {
  const supabase = createUserClient(req);
  
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error) {
    console.error('[Auth] getUser error:', error.message);
    
    if (error.message.toLowerCase().includes('jwt') || 
        error.message.toLowerCase().includes('token') ||
        error.message.toLowerCase().includes('expired')) {
      throw new AuthError('Invalid or expired token', 401);
    }
    
    throw new AuthError(error.message, 401);
  }
  
  if (!user) {
    throw new AuthError('No user found for token', 401);
  }
  
  return { user, supabase };
}

/**
 * Custom error class for authentication errors
 */
export class AuthError extends Error {
  status: number;
  code: number;
  
  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = status;
  }
}

/**
 * Creates a JSON error response with CORS headers
 */
export function errorResponse(message: string, status: number = 500): Response {
  return new Response(
    JSON.stringify({ code: status, message }),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}

/**
 * Creates a JSON success response with CORS headers
 */
export function jsonResponse<T>(data: T, status: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}

/**
 * Handle CORS preflight requests
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}
