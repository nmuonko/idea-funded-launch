/**
 * Auth Helper - SDK-free REST-based implementation
 * Uses direct REST API calls to avoid bundle bloat
 */

import { PostgrestClient, createPostgrestClient, createAdminPostgrestClient, getDbClient as getPostgrestDbClient } from "./postgrest.ts";

// Use 'any' for SupabaseClient type (backward compatibility)
type SupabaseClient = any;
type User = any;

// Re-export PostgrestClient for modules that want to use it directly
export { PostgrestClient, createPostgrestClient, createAdminPostgrestClient };

/**
 * Get PostgREST DB client from request - extracts JWT from Authorization header
 * This is the preferred way to get a database client in edge functions
 */
export function getDbClient(req: Request): PostgrestClient {
  return getPostgrestDbClient(req);
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, X-Afrishop-Environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id, x-auth-token, x-session-token, x-access-token, x-supabase-auth, x-jwt',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const trimmed = authHeader.trim();
  const parts = trimmed.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }

  // Frozen mobile builds may send the raw JWT without the Bearer prefix.
  return trimmed.length > 20 ? trimmed : null;
}

function extractTokenFromPayload(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload.access_token,
    payload.accessToken,
    payload.token,
    payload.jwt,
    payload.authToken,
    payload.auth_token,
    payload.bearerToken,
    payload.bearer_token,
    payload.sessionToken,
    payload.session_token,
    payload.session?.access_token,
    payload.session?.accessToken,
    payload.session?.token,
    payload.data?.session?.access_token,
    payload.data?.session?.accessToken,
    payload.data?.session?.token,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = extractBearerToken(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}

export async function extractRequestToken(req: Request): Promise<{ token: string | null; source: string | null }> {
  const headerCandidates = [
    req.headers.get('Authorization'),
    req.headers.get('authorization'),
    req.headers.get('x-access-token'),
    req.headers.get('x-auth-token'),
    req.headers.get('x-supabase-auth'),
    req.headers.get('x-jwt'),
    req.headers.get('x-session-token'),
  ];

  for (const candidate of headerCandidates) {
    const token = extractBearerToken(candidate);
    if (token) return { token, source: 'header' };
  }

  try {
    const url = new URL(req.url);
    for (const key of ['access_token', 'accessToken', 'token', 'jwt', 'authToken', 'auth_token', 'bearerToken', 'bearer_token', 'sessionToken', 'session_token']) {
      const token = extractBearerToken(url.searchParams.get(key));
      if (token) return { token, source: 'query' };
    }
  } catch {
    // ignore malformed URL edge cases
  }

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const payload = await req.clone().json();
      const token = extractTokenFromPayload(payload);
      if (token) return { token, source: 'body' };
    } catch {
      // ignore invalid JSON bodies
    }
  }

  return { token: null, source: null };
}

export const MOBILE_ALT_AUTH_HEADER_NAMES = [
  'x-auth-token',
  'x-session-token',
  'x-access-token',
  'x-jwt',
  'x-supabase-auth',
] as const;

export const MOBILE_FORWARD_HEADER_NAMES = [
  ...MOBILE_ALT_AUTH_HEADER_NAMES,
  'x-device-id',
  'x-client-info',
  'user-agent',
  'X-Afrishop-Environment',
] as const;

const KNOWN_AUTH_ERROR_CODES = new Set(['NO_TOKEN', 'INVALID_TOKEN', 'EXPIRED_TOKEN']);

export function getRequestAuthDiagnostics(
  req: Request,
  token?: string | null,
  source?: string | null,
) {
  return {
    tokenSource: source || 'missing',
    hasAuthorizationHeader: !!(req.headers.get('Authorization') || req.headers.get('authorization')),
    hasExtractedToken: !!token,
    alternateHeaders: Object.fromEntries(
      MOBILE_ALT_AUTH_HEADER_NAMES.map((header) => [header, !!req.headers.get(header)]),
    ),
  };
}

export function normalizeAuthErrorCode(error: unknown): string | null {
  const rawCode = String(
    (error as any)?.authErrorCode ??
    (error as any)?.error_code ??
    (error as any)?.code ??
    (error as any)?.error ??
    '',
  ).toUpperCase();

  if (KNOWN_AUTH_ERROR_CODES.has(rawCode)) {
    return rawCode;
  }

  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  if (!message) return null;
  if (message.includes('expired') || message.includes('exp claim')) return 'EXPIRED_TOKEN';
  if (
    message.includes('auth') ||
    message.includes('token') ||
    message.includes('jwt') ||
    message.includes('unauthenticated')
  ) {
    return 'INVALID_TOKEN';
  }

  return null;
}

export function authErrorPayload(errorCode = 'INVALID_TOKEN', message?: string) {
  const normalizedCode = normalizeAuthErrorCode({ authErrorCode: errorCode }) || 'INVALID_TOKEN';
  const defaultMessage = normalizedCode === 'NO_TOKEN'
    ? 'No authentication token found. Please sign in.'
    : normalizedCode === 'EXPIRED_TOKEN'
    ? 'Session expired. Please sign in again.'
    : 'Authentication failed. Please sign in again.';

  return {
    ok: false,
    success: false,
    authenticated: false,
    error: normalizedCode,
    error_code: normalizedCode,
    message: message || defaultMessage,
  };
}

export function authErrorResponse(
  errorCode = 'INVALID_TOKEN',
  message?: string,
  extras: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    ...authErrorPayload(errorCode, message),
    ...extras,
  }, 200);
}

export function buildForwardHeaders(
  req: Request,
  token?: string | null,
  options: {
    includeApiKey?: boolean;
    includeCronSecret?: boolean;
    contentType?: string | null;
  } = {},
): Headers {
  const headers = new Headers();
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');

  if (authHeader) {
    headers.set('Authorization', authHeader);
  } else if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.contentType !== null) {
    headers.set('Content-Type', options.contentType || 'application/json');
  }

  for (const header of MOBILE_FORWARD_HEADER_NAMES) {
    const value = req.headers.get(header);
    if (value) headers.set(header, value);
  }

  if (options.includeCronSecret) {
    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret) headers.set('x-cron-secret', cronSecret);
  }

  if (options.includeApiKey !== false) {
    headers.set('apikey', Deno.env.get('SUPABASE_ANON_KEY') || '');
  }

  return headers;
}

export function extractDownstreamAuthFailure(responseStatus: number, responseBody: string) {
  let parsed: any = null;

  try {
    parsed = responseBody ? JSON.parse(responseBody) : null;
  } catch {
    parsed = null;
  }

  const parsedCode = normalizeAuthErrorCode(parsed);
  const textIndicatesAuthFailure = /UNAUTHENTICATED|AUTH_REQUIRED|INVALID_AUTH|INVALID_TOKEN|EXPIRED_TOKEN|NO_TOKEN/i.test(responseBody || '');
  const isAuthFailure =
    responseStatus === 401 ||
    responseStatus === 403 ||
    parsed?.authenticated === false ||
    !!parsedCode ||
    textIndicatesAuthFailure;

  if (!isAuthFailure) return null;

  const errorCode = parsedCode || (responseStatus === 401 || responseStatus === 403 ? 'INVALID_TOKEN' : 'INVALID_TOKEN');
  const payload = authErrorPayload(errorCode, parsed?.message);

  return {
    errorCode: payload.error_code,
    message: payload.message,
  };
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
      select: (cols = "*", opts?: { count?: string; head?: boolean }) => createQueryBuilder(url, table, cols, baseHeaders, 'GET', opts),
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

function createQueryBuilder(url: string, table: string, cols: string, headers: Record<string, string>, _method: string, selectOpts?: { count?: string; head?: boolean }) {
  const builder = {
    _table: table,
    _cols: cols,
    _filters: [] as string[],
    _single: false,
    _order: null as string | null,
    _limit: null as number | null,
    _rangeFrom: null as number | null,
    _rangeTo: null as number | null,
    _count: selectOpts?.count || null as string | null,
    _head: selectOpts?.head || false,
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
    range(from: number, to: number) { this._rangeFrom = from; this._rangeTo = to; return this; },
    maybeSingle() { this._single = true; return this; },
    single() { this._single = true; return this; },
    async then(resolve: (v: unknown) => void) {
      const params = [`select=${encodeURIComponent(this._cols)}`, ...this._filters];
      if (this._order) params.push(`order=${this._order}`);
      if (this._limit !== null) params.push(`limit=${this._limit}`);
      
      const finalHeaders: Record<string, string> = this._single 
        ? { ...headers, Accept: 'application/vnd.pgrst.object+json' } 
        : { ...headers };

      // Support range() for pagination
      if (this._rangeFrom !== null && this._rangeTo !== null) {
        finalHeaders['Range'] = `${this._rangeFrom}-${this._rangeTo}`;
        finalHeaders['Range-Unit'] = 'items';
      }

      // Support count option (e.g. { count: 'exact' })
      if (this._count) {
        finalHeaders['Prefer'] = `count=${this._count}`;
      }

      const method = this._head ? 'HEAD' : 'GET';
        
      try {
        const res = await fetch(`${url}/rest/v1/${this._table}?${params.join('&')}`, { 
          method,
          headers: finalHeaders,
        });
        if (!res.ok) {
          const errText = method === 'HEAD' ? '' : await res.text();
          // Handle 406 for single() when no rows found
          if (res.status === 406 && this._single) {
            return resolve({ data: null, error: null, count: 0 });
          }
          return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` }, count: null });
        }

        // Parse count from content-range header (format: "*/total" or "from-to/total")
        let count: number | null = null;
        const contentRange = res.headers.get('content-range');
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)$/);
          if (match) count = parseInt(match[1], 10);
        }

        if (this._head) {
          return resolve({ data: null, error: null, count });
        }

        return resolve({ data: await res.json(), error: null, count });
      } catch (e: unknown) { 
        return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) }, count: null }); 
      }
    }
  };
  return builder;
}

function createMutationBuilder(url: string, table: string, rows: unknown, headers: Record<string, string>, method: string) {
  return {
    _rows: rows,
    _single: false,
    select(cols?: string) {
      const parent = this;
      return {
        _cols: cols,
        _single: false,
        single() { this._single = true; return this; },
        maybeSingle() { this._single = true; return this; },
        async then(resolve: (v: unknown) => void) {
          try {
            const selectParam = this._cols ? `?select=${encodeURIComponent(this._cols)}` : '';
            const finalHeaders = this._single 
              ? { ...headers, Prefer: 'return=representation', Accept: 'application/vnd.pgrst.object+json' }
              : { ...headers, Prefer: 'return=representation' };
            const res = await fetch(`${url}/rest/v1/${table}${selectParam}`, {
              method,
              headers: finalHeaders,
              body: JSON.stringify(rows),
            });
            if (!res.ok) {
              const errText = await res.text();
              // Handle 406 for single() when no rows returned
              if (res.status === 406 && this._single) {
                return resolve({ data: null, error: null });
              }
              return resolve({ data: null, error: { message: `${res.status}: ${errText.substring(0, 100)}` } });
            }
            const data = await res.json();
            return resolve({ data, error: null });
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
    lt(col: string, val: unknown) { this._filters.push(`${col}=lt.${encodeURIComponent(String(val))}`); return this; },
    gt(col: string, val: unknown) { this._filters.push(`${col}=gt.${encodeURIComponent(String(val))}`); return this; },
    lte(col: string, val: unknown) { this._filters.push(`${col}=lte.${encodeURIComponent(String(val))}`); return this; },
    gte(col: string, val: unknown) { this._filters.push(`${col}=gte.${encodeURIComponent(String(val))}`); return this; },
    select(cols?: string) {
      const parentBuilder = builder;
      return {
        _cols: cols,
        _single: false,
        single() { this._single = true; return this; },
        maybeSingle() { this._single = true; return this; },
        async then(resolve: (v: unknown) => void) {
          const filterStr = parentBuilder._filters.length > 0 ? `?${parentBuilder._filters.join('&')}` : '';
          const selectParam = this._cols ? `${filterStr ? '&' : '?'}select=${encodeURIComponent(this._cols)}` : '';
          const finalHeaders = this._single 
            ? { ...headers, Prefer: 'return=representation', Accept: 'application/vnd.pgrst.object+json' }
            : { ...headers, Prefer: 'return=representation' };
          try {
            const res = await fetch(`${url}/rest/v1/${table}${filterStr}${selectParam}`, {
              method: 'PATCH',
              headers: finalHeaders,
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const errText = await res.text();
              // Handle 406 for single() when no rows returned
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
export async function verifyAndGetUser(
  req: Request,
  _supabase?: any,
  authContext?: { token?: string | null; source?: string | null },
): Promise<{ user: User; supabase: SupabaseClient }> {
  const extracted = authContext ?? await extractRequestToken(req);
  const token = extracted?.token ?? null;
  const source = extracted?.source ?? null;

  if (!token) {
    const err = new AuthError('Missing or invalid Authorization header', 401);
    (err as any).authErrorCode = 'NO_TOKEN';
    throw err;
  }

  const hasAuthorizationHeader = !!req.headers.get('Authorization');

  // Check cache first
  const cached = authCache.get(token);
  if (cached && Date.now() < cached.expiry) {
    console.log('[Auth] Authenticated request via cache', {
      source: source || 'unknown',
      hasAuthorizationHeader,
    });
    // Return a USER-context client so auth.uid() resolves correctly for RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    return { user: cached.user, supabase: createRestClient(supabaseUrl, supabaseAnonKey, token) };
  }

  // Use admin client to verify the exact token already extracted upstream
  const adminClient = createAdminClient();
  const { data: { user }, error } = await adminClient.auth.getUser(token);

  if (error) {
    const errMsg = error.message || '';
    const isExpired = errMsg.toLowerCase().includes('expired') || errMsg.toLowerCase().includes('exp claim');
    console.error('[Auth] Token verification failed:', errMsg, 'source=', source, 'hasAuthorizationHeader=', hasAuthorizationHeader, 'isExpired=', isExpired);
    const authErr = new AuthError(isExpired ? 'Token expired' : 'Invalid JWT', 401);
    (authErr as any).authErrorCode = isExpired ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN';
    throw authErr;
  }

  if (!user) {
    throw new AuthError('Invalid JWT - no user found', 401);
  }

  console.log('[Auth] Authenticated request via', source || 'unknown', 'hasAuthorizationHeader=', hasAuthorizationHeader);

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

  // Return a USER-context client so auth.uid() resolves correctly for RLS queries
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  return { user, supabase: createRestClient(supabaseUrl, supabaseAnonKey, token) };
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
