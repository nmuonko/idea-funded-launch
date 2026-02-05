/**
 * Lightweight auth helpers using direct REST calls
 * Avoids importing @supabase/supabase-js to prevent bundle bloat
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id',
};

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  return parts[1];
}

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
  });
}

export function errorResponse(error: string, message: string, status = 400): Response {
  return jsonResponse({ ok: false, error, message }, status);
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

/**
 * Verify JWT token using Supabase REST API
 */
export async function verifyAuth(req: Request): Promise<{ user: AuthUser | null; error?: string }> {
  const authHeader = req.headers.get('Authorization');
  const token = extractBearerToken(authHeader);

  if (!token) {
    return { user: null, error: 'Missing or invalid Authorization header' };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return { user: null, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceRoleKey,
      },
    });

    if (!response.ok) {
      return { user: null, error: `Auth failed: ${response.status}` };
    }

    const user = await response.json();
    return { user: { id: user.id, email: user.email, role: user.role } };
  } catch (err) {
    return { user: null, error: err instanceof Error ? err.message : 'Auth verification failed' };
  }
}

/**
 * Execute a REST query against Supabase
 */
export async function restQuery<T = unknown>(
  table: string,
  query: string = '',
  options: { method?: string; body?: unknown; single?: boolean } = {}
): Promise<{ data: T | null; error?: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return { data: null, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }

  const url = `${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  if (options.single) {
    headers['Accept'] = 'application/vnd.pgrst.object+json';
  }

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { data: null, error: `DB error ${response.status}: ${errorText.substring(0, 200)}` };
    }

    const data = await response.json();
    return { data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Query failed' };
  }
}

/**
 * Execute a database function via RPC
 */
export async function restRpc<T = unknown>(
  functionName: string,
  params: Record<string, unknown> = {}
): Promise<{ data: T | null; error?: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return { data: null, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { data: null, error: `RPC error ${response.status}: ${errorText.substring(0, 200)}` };
    }

    const data = await response.json();
    return { data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'RPC failed' };
  }
}
