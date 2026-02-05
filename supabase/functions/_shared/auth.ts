/**
 * Auth Helper - SDK-free REST-based implementation
 * Uses direct REST API calls to avoid bundle bloat
 */

// Use 'any' for SupabaseClient type
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

/**
 * Create a minimal REST-based client that mimics the Supabase client API
 */
function createRestClient(url: string, key: string, userToken?: string): SupabaseClient {
  const authToken = userToken || key;
  const baseHeaders: Record<string, string> = { 
    apikey: key, 
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  return {
    from: (table: string) => ({
      select: (cols = "*") => createQueryBuilder(url, table, cols, baseHeaders, 'GET'),
      insert: (rows: unknown) => createMutationBuilder(url, table, rows, baseHeaders, 'POST'),
      update: (data: unknown) => createUpdateBuilder(url, table, data, baseHeaders),
      upsert: (rows: unknown, opts?: { onConflict?: string }) => 
        createUpsertBuilder(url, table, rows, baseHeaders, opts?.onConflict),
      delete: () => createDeleteBuilder(url, table, baseHeaders),
    }),
    rpc: (fn: string, params?: Record<string, unknown>) => ({
      then: async (resolve: (v: unknown) => void) => {
        try {
          const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            headers: baseHeaders,
            body: JSON.stringify(params || {}),
          });
          if (!res.ok) {
            const errText = await res.text();
            return resolve({ data: null, error: { message: `RPC error ${res.status}: ${errText.substring(0, 100)}` } });
          }
          return resolve({ data: await res.json(), error: null });
        } catch (e: unknown) {
          return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
        }
      },
    }),
    auth: {
      getUser: async (token?: string) => {
        try {
          const authToken = token || extractBearerToken(baseHeaders.Authorization) || key;
          const res = await fetch(`${url}/auth/v1/user`, {
            headers: {
              apikey: key,
              Authorization: `Bearer ${authToken}`,
            },
          });
          if (!res.ok) {
            return { data: { user: null }, error: { message: `Auth error: ${res.status}` } };
          }
          const user = await res.json();
          return { data: { user }, error: null };
        } catch (e: unknown) {
          return { data: { user: null }, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },
    },
  };
}

function createQueryBuilder(url: string, table: string, cols: string, headers: Record<string, string>, _method: string) {
  const builder = {
    _table: table,
    _cols: cols,
    _filters: [] as string[],
    _single: false,
    _order: null as string | null,
    _limit: null as number | null,
    eq(col: string, val: unknown) { this._filters.push(`${col}=eq.${encodeURIComponent(String(val))}`); return this; },
    neq(col: string, val: unknown) { this._filters.push(`${col}=neq.${encodeURIComponent(String(val))}`); return this; },
    in(col: string, vals: unknown[]) { this._filters.push(`${col}=in.(${vals.map(v => encodeURIComponent(String(v))).join(",")})`); return this; },
    is(col: string, val: unknown) { this._filters.push(`${col}=is.${val}`); return this; },
    gte(col: string, val: unknown) { this._filters.push(`${col}=gte.${encodeURIComponent(String(val))}`); return this; },
    lte(col: string, val: unknown) { this._filters.push(`${col}=lte.${encodeURIComponent(String(val))}`); return this; },
    gt(col: string, val: unknown) { this._filters.push(`${col}=gt.${encodeURIComponent(String(val))}`); return this; },
    lt(col: string, val: unknown) { this._filters.push(`${col}=lt.${encodeURIComponent(String(val))}`); return this; },
    like(col: string, val: string) { this._filters.push(`${col}=like.${encodeURIComponent(val)}`); return this; },
    ilike(col: string, val: string) { this._filters.push(`${col}=ilike.${encodeURIComponent(val)}`); return this; },
    order(col: string, opts?: { ascending?: boolean }) { 
      this._order = `${col}.${opts?.ascending === false ? "desc" : "asc"}`; 
      return this; 
    },
    limit(n: number) { this._limit = n; return this; },
    maybeSingle() { this._single = true; return this; },
    single() { this._single = true; return this; },
    async then(resolve: (v: unknown) => void) {
      const params = [`select=${encodeURIComponent(this._cols)}`, ...this._filters];
      if (this._order) params.push(`order=${this._order}`);
      if (this._limit !== null) params.push(`limit=${this._limit}`);
      
      const finalHeaders = this._single 
        ? { ...headers, Accept: 'application/vnd.pgrst.object+json' } 
        : headers;
        
      try {
        const res = await fetch(`${url}/rest/v1/${this._table}?${params.join('&')}`, { 
          method: 'GET',
          headers: finalHeaders,
        });
        if (!res.ok) {
          const errText = await res.text();
          // Handle 406 for single() when no rows found
          if (res.status === 406 && this._single) {
            return resolve({ data: null, error: null });
          }
          return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
        }
        return resolve({ data: await res.json(), error: null });
      } catch (e: unknown) { 
        return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }); 
      }
    }
  };
  return builder;
}

function createMutationBuilder(url: string, table: string, rows: unknown, headers: Record<string, string>, method: string) {
  return {
    _rows: rows,
    select(cols?: string) {
      return {
        then: async (resolve: (v: unknown) => void) => {
          try {
            const selectParam = cols ? `?select=${encodeURIComponent(cols)}` : '';
            const res = await fetch(`${url}/rest/v1/${table}${selectParam}`, {
              method,
              headers: { ...headers, Prefer: 'return=representation' },
              body: JSON.stringify(rows),
            });
            if (!res.ok) {
              const errText = await res.text();
              return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
            }
            return resolve({ data: await res.json(), error: null });
          } catch (e: unknown) {
            return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
          }
        }
      };
    },
    async then(resolve: (v: unknown) => void) {
      try {
        const res = await fetch(`${url}/rest/v1/${table}`, {
          method,
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify(rows),
        });
        if (!res.ok) {
          const errText = await res.text();
          return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
        }
        return resolve({ data: await res.json(), error: null });
      } catch (e: unknown) {
        return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    }
  };
}

function createUpdateBuilder(url: string, table: string, data: unknown, headers: Record<string, string>) {
  const builder = {
    _data: data,
    _filters: [] as string[],
    eq(col: string, val: unknown) { this._filters.push(`${col}=eq.${encodeURIComponent(String(val))}`); return this; },
    neq(col: string, val: unknown) { this._filters.push(`${col}=neq.${encodeURIComponent(String(val))}`); return this; },
    in(col: string, vals: unknown[]) { this._filters.push(`${col}=in.(${vals.map(v => encodeURIComponent(String(v))).join(",")})`); return this; },
    is(col: string, val: unknown) { this._filters.push(`${col}=is.${val}`); return this; },
    select(cols?: string) {
      return {
        then: async (resolve: (v: unknown) => void) => {
          const filterStr = builder._filters.length > 0 ? `?${builder._filters.join('&')}` : '';
          const selectParam = cols ? `${filterStr ? '&' : '?'}select=${encodeURIComponent(cols)}` : '';
          try {
            const res = await fetch(`${url}/rest/v1/${table}${filterStr}${selectParam}`, {
              method: 'PATCH',
              headers: { ...headers, Prefer: 'return=representation' },
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const errText = await res.text();
              return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
            }
            return resolve({ data: await res.json(), error: null });
          } catch (e: unknown) {
            return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
          }
        }
      };
    },
    async then(resolve: (v: unknown) => void) {
      const filterStr = this._filters.length > 0 ? `?${this._filters.join('&')}` : '';
      try {
        const res = await fetch(`${url}/rest/v1/${table}${filterStr}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const errText = await res.text();
          return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
        }
        return resolve({ data: await res.json(), error: null });
      } catch (e: unknown) {
        return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    }
  };
  return builder;
}

function createDeleteBuilder(url: string, table: string, headers: Record<string, string>) {
  const builder = {
    _filters: [] as string[],
    eq(col: string, val: unknown) { this._filters.push(`${col}=eq.${encodeURIComponent(String(val))}`); return this; },
    neq(col: string, val: unknown) { this._filters.push(`${col}=neq.${encodeURIComponent(String(val))}`); return this; },
    in(col: string, vals: unknown[]) { this._filters.push(`${col}=in.(${vals.map(v => encodeURIComponent(String(v))).join(",")})`); return this; },
    async then(resolve: (v: unknown) => void) {
      const filterStr = this._filters.length > 0 ? `?${this._filters.join('&')}` : '';
      try {
        const res = await fetch(`${url}/rest/v1/${table}${filterStr}`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok) {
          const errText = await res.text();
          return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
        }
        // DELETE may return empty body
        const text = await res.text();
        return resolve({ data: text ? JSON.parse(text) : null, error: null });
      } catch (e: unknown) {
        return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    }
  };
  return builder;
}

function createUpsertBuilder(url: string, table: string, rows: unknown, headers: Record<string, string>, onConflict?: string) {
  const prefer = onConflict 
    ? `resolution=merge-duplicates,return=representation`
    : 'return=representation';
    
  return {
    _rows: rows,
    select(cols?: string) {
      return {
        then: async (resolve: (v: unknown) => void) => {
          const params: string[] = [];
          if (cols) params.push(`select=${encodeURIComponent(cols)}`);
          if (onConflict) params.push(`on_conflict=${onConflict}`);
          const queryStr = params.length > 0 ? `?${params.join('&')}` : '';
          try {
            const res = await fetch(`${url}/rest/v1/${table}${queryStr}`, {
              method: 'POST',
              headers: { ...headers, Prefer: prefer },
              body: JSON.stringify(rows),
            });
            if (!res.ok) {
              const errText = await res.text();
              return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
            }
            return resolve({ data: await res.json(), error: null });
          } catch (e: unknown) {
            return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
          }
        }
      };
    },
    async then(resolve: (v: unknown) => void) {
      const queryStr = onConflict ? `?on_conflict=${onConflict}` : '';
      try {
        const res = await fetch(`${url}/rest/v1/${table}${queryStr}`, {
          method: 'POST',
          headers: { ...headers, Prefer: prefer },
          body: JSON.stringify(rows),
        });
        if (!res.ok) {
          const errText = await res.text();
          return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
        }
        return resolve({ data: await res.json(), error: null });
      } catch (e: unknown) {
        return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    }
  };
}

// Module-level admin client instance for connection reuse
let adminClientInstance: SupabaseClient | null = null;

/**
 * Creates or returns a cached Supabase admin client using SERVICE_ROLE key
 * This bypasses RLS and should only be used for server-side operations
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

  adminClientInstance = createRestClient(supabaseUrl, supabaseServiceRoleKey);
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
  const token = extractBearerToken(authHeader);

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }

  return createRestClient(supabaseUrl, supabaseAnonKey, token || undefined);
}

// Short-lived auth cache for repeated auth checks within edge function lifecycle
const authCache = new Map<string, { user: User; expiry: number }>();
const AUTH_CACHE_TTL = 30_000; // 30 seconds

/**
 * Verifies JWT token and returns the authenticated user
 * Uses SERVICE_ROLE to validate the token server-side
 */
export async function verifyAndGetUser(req: Request, _supabase?: any): Promise<{ user: User; supabase: SupabaseClient }> {
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
  
  // Clean up old cache entries periodically
  if (authCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of authCache.entries()) {
      if (now >= value.expiry) {
        authCache.delete(key);
      }
    }
  }
  
  return { user, supabase: adminClient };
}

/**
 * Gets the authenticated user using the request's Authorization header
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
 * Creates a 401 Unauthorized response with CORS headers
 */
export function unauthorizedResponse(headers: Record<string, string> = corsHeaders): Response {
  return new Response(
    JSON.stringify({ ok: false, error: "Unauthorized" }),
    { 
      status: 401, 
      headers: { ...headers, 'Content-Type': 'application/json' } 
    }
  );
}

/**
 * Creates a JSON error response with CORS headers
 */
export function errorResponse(
  message: string, 
  statusOrHeaders: number | Record<string, string> = 500,
  status: number = 500
): Response {
  let finalStatus: number;
  let finalHeaders: Record<string, string>;
  
  if (typeof statusOrHeaders === 'number') {
    finalStatus = statusOrHeaders;
    finalHeaders = corsHeaders;
  } else {
    finalStatus = status;
    finalHeaders = statusOrHeaders;
  }
  
  return new Response(
    JSON.stringify({ ok: false, code: finalStatus, message }),
    { 
      status: finalStatus, 
      headers: { ...finalHeaders, 'Content-Type': 'application/json' } 
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
  } catch (_e) {
    // Silently fail - don't impact main request
  }
}
