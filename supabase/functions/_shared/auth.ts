import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Creates an authenticated Supabase client from the request
 * @param req - The incoming request
 * @returns Supabase client configured with the user's auth token
 */
export function createAuthenticatedClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader) {
    throw new AuthError('Missing Authorization header', 401);
  }

  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { 
      global: { 
        headers: { Authorization: authHeader } 
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    }
  );
}

/**
 * Gets the authenticated user from the request
 * @param req - The incoming request
 * @returns The authenticated user and Supabase client
 * @throws AuthError if not authenticated
 */
export async function getAuthenticatedUser(req: Request): Promise<{ user: User; supabase: SupabaseClient }> {
  const supabase = createAuthenticatedClient(req);
  
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error) {
    console.error('[Auth] getUser error:', error.message);
    
    // Check for specific JWT errors
    if (error.message.toLowerCase().includes('jwt') || 
        error.message.toLowerCase().includes('token') ||
        error.message.toLowerCase().includes('expired')) {
      throw new AuthError('Invalid or expired token. Please refresh your session.', 401);
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
  
  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Creates an error response with CORS headers
 */
export function errorResponse(message: string, status: number = 500): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}

/**
 * Creates a success response with CORS headers
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
