import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Use 'any' for SupabaseClient type to prevent version mismatches across functions
type SupabaseClient = any;
type User = any;

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

// Module-level admin client instance for connection reuse
let adminClientInstance: SupabaseClient | null = null;

/**
 * Creates or returns a cached Supabase admin client using SERVICE_ROLE key
 * This bypasses RLS and should only be used for server-side operations
 * Connection is reused across requests for better performance
 */
export function createAdminClient(): SupabaseClient {
  if (adminClientInstance) {
    return adminClientInstance;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  adminClientInstance = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'x-request-timeout': '5000', // 5 second query timeout
      },
    },
  });

  return adminClientInstance;
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

// Short-lived auth cache for repeated auth checks within edge function lifecycle
const authCache = new Map<string, { user: User; expiry: number }>();
const AUTH_CACHE_TTL = 30_000; // 30 seconds

/**
 * Verifies JWT token and returns the authenticated user
 * Uses SERVICE_ROLE to validate the token server-side
 * Includes short-lived caching for performance (30s TTL)
 */
export async function verifyAndGetUser(req: Request): Promise<{ user: User; supabase: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  const token = extractBearerToken(authHeader);
  
  if (!token) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  // Check cache first
  const cached = authCache.get(token);
  if (cached && Date.now() < cached.expiry) {
    return { user: cached.user, supabase: createAdminClient() };
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
  
  // Cache the result for 30 seconds
  authCache.set(token, { user, expiry: Date.now() + AUTH_CACHE_TTL });
  
  // Clean up old cache entries periodically (every 100 verifications)
  if (authCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of authCache.entries()) {
      if (now >= value.expiry) {
        authCache.delete(key);
      }
    }
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

/**
 * Log performance metrics to the database (async, non-blocking)
 */
export async function logPerformanceMetric(
  supabase: SupabaseClient,
  functionName: string,
  durationMs: number,
  success: boolean = true,
  userId?: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    // Fire and forget - don't await
    supabase.from('performance_metrics').insert({
      function_name: functionName,
      duration_ms: durationMs,
      success,
      user_id: userId || null,
      metadata: metadata || {},
    }).then(() => {});
  } catch (e) {
    // Silently fail - don't impact main request
  }
}