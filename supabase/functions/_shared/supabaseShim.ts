/**
 * Supabase Client Shim
 * 
 * Lightweight replacement for @supabase/supabase-js SDK
 * Exports createClient that uses direct REST API calls
 * to avoid bundle bloat in Edge Functions.
 * 
 * This module is designed to be import-mapped from:
 *   "@supabase/supabase-js" -> "./_shared/supabaseShim.ts"
 */

// Re-export the REST-based client as createClient
export { createAdminClient, createUserClient } from "./auth.ts";

// Type placeholder for SupabaseClient
export type SupabaseClient = any;

/**
 * createClient - REST-based replacement for @supabase/supabase-js
 * 
 * Mimics the Supabase SDK API but uses direct fetch calls.
 * Supports: from().select/insert/update/delete, auth.getUser(), rpc()
 */
export function createClient(
  supabaseUrl: string,
  supabaseKey: string,
  options?: { 
    global?: { headers?: Record<string, string> };
    auth?: any;
  }
): SupabaseClient {
  // Extract token from Authorization header if provided via options
  let userToken: string | undefined;
  const authHeader = options?.global?.headers?.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    userToken = authHeader.substring(7);
  }

  const baseHeaders: Record<string, string> = { 
    apikey: supabaseKey, 
    Authorization: `Bearer ${userToken || supabaseKey}`,
    'Content-Type': 'application/json',
  };

  return {
    from: (table: string) => ({
      select: (cols = "*") => createQueryBuilder(supabaseUrl, table, cols, baseHeaders, 'GET'),
      insert: (rows: unknown) => createMutationBuilder(supabaseUrl, table, rows, baseHeaders, 'POST'),
      update: (data: unknown) => createUpdateBuilder(supabaseUrl, table, data, baseHeaders),
      upsert: (rows: unknown, opts?: { onConflict?: string }) => 
        createUpsertBuilder(supabaseUrl, table, rows, baseHeaders, opts?.onConflict),
      delete: () => createDeleteBuilder(supabaseUrl, table, baseHeaders),
    }),
    rpc: (fn: string, params?: Record<string, unknown>) => ({
      then: async (resolve: (v: unknown) => void) => {
        try {
          const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
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
          const authToken = token || userToken || supabaseKey;
          const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
              apikey: supabaseKey,
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
      signInWithPassword: async (credentials: { email: string; password: string }) => {
        try {
          const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
              apikey: supabaseKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(credentials),
          });
          if (!res.ok) {
            const err = await res.json();
            return { data: null, error: { message: err.error_description || err.msg || `Auth error: ${res.status}` } };
          }
          const data = await res.json();
          return { data: { user: data.user, session: data }, error: null };
        } catch (e: unknown) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },
      admin: {
        createUser: async (opts: { email: string; password?: string; email_confirm?: boolean }) => {
          try {
            const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
              method: 'POST',
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(opts),
            });
            if (!res.ok) {
              const err = await res.json();
              return { data: null, error: { message: err.msg || `Admin error: ${res.status}` } };
            }
            const user = await res.json();
            return { data: { user }, error: null };
          } catch (e: unknown) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },
        getUserById: async (userId: string) => {
          try {
            const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
              },
            });
            if (!res.ok) {
              return { data: null, error: { message: `User not found: ${res.status}` } };
            }
            const user = await res.json();
            return { data: { user }, error: null };
          } catch (e: unknown) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },
        updateUserById: async (userId: string, attrs: Record<string, unknown>) => {
          try {
            const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
              method: 'PUT',
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(attrs),
            });
            if (!res.ok) {
              const err = await res.json();
              return { data: null, error: { message: err.msg || `Update error: ${res.status}` } };
            }
            const user = await res.json();
            return { data: { user }, error: null };
          } catch (e: unknown) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },
        inviteUserByEmail: async (email: string, opts?: { redirectTo?: string }) => {
          try {
            const res = await fetch(`${supabaseUrl}/auth/v1/invite`, {
              method: 'POST',
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ email, ...opts }),
            });
            if (!res.ok) {
              const err = await res.json();
              return { data: null, error: { message: err.msg || `Invite error: ${res.status}` } };
            }
            const user = await res.json();
            return { data: { user }, error: null };
          } catch (e: unknown) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: Blob | ArrayBuffer, opts?: { contentType?: string; upsert?: boolean }) => {
          try {
            const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
              method: opts?.upsert ? 'PUT' : 'POST',
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${userToken || supabaseKey}`,
                'Content-Type': opts?.contentType || 'application/octet-stream',
              },
              body: file,
            });
            if (!res.ok) {
              const err = await res.json();
              return { data: null, error: { message: err.message || `Upload error: ${res.status}` } };
            }
            const data = await res.json();
            return { data: { path: data.Key || path }, error: null };
          } catch (e: unknown) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  };
}

// ==================== Query Builders ====================

function createQueryBuilder(url: string, table: string, cols: string, headers: Record<string, string>, _method: string) {
  const builder = {
    _table: table,
    _cols: cols,
    _filters: [] as string[],
    _single: false,
    _maybeSingle: false,
    _order: null as string | null,
    _limit: null as number | null,
    _range: null as { from: number; to: number } | null,
    eq(col: string, val: unknown) { this._filters.push(`${col}=eq.${encodeURIComponent(String(val))}`); return this; },
    neq(col: string, val: unknown) { this._filters.push(`${col}=neq.${encodeURIComponent(String(val))}`); return this; },
    in(col: string, vals: unknown[]) { this._filters.push(`${col}=in.(${vals.map(v => encodeURIComponent(String(v))).join(",")})`); return this; },
    is(col: string, val: unknown) { this._filters.push(`${col}=is.${val}`); return this; },
    not(col: string, op: string, val: unknown) { this._filters.push(`${col}=not.${op}.${val === null ? 'null' : encodeURIComponent(String(val))}`); return this; },
    gte(col: string, val: unknown) { this._filters.push(`${col}=gte.${encodeURIComponent(String(val))}`); return this; },
    lte(col: string, val: unknown) { this._filters.push(`${col}=lte.${encodeURIComponent(String(val))}`); return this; },
    gt(col: string, val: unknown) { this._filters.push(`${col}=gt.${encodeURIComponent(String(val))}`); return this; },
    lt(col: string, val: unknown) { this._filters.push(`${col}=lt.${encodeURIComponent(String(val))}`); return this; },
    like(col: string, val: string) { this._filters.push(`${col}=like.${encodeURIComponent(val)}`); return this; },
    ilike(col: string, val: string) { this._filters.push(`${col}=ilike.${encodeURIComponent(val)}`); return this; },
    or(conditions: string) { this._filters.push(`or=(${encodeURIComponent(conditions)})`); return this; },
    order(col: string, opts?: { ascending?: boolean }) { 
      this._order = `${col}.${opts?.ascending === false ? "desc" : "asc"}`; 
      return this; 
    },
    limit(n: number) { this._limit = n; return this; },
    range(from: number, to: number) { this._range = { from, to }; return this; },
    maybeSingle() { this._maybeSingle = true; this._single = true; return this; },
    single() { this._single = true; return this; },
    async then(resolve: (v: unknown) => void) {
      const params = [`select=${encodeURIComponent(this._cols)}`, ...this._filters];
      if (this._order) params.push(`order=${this._order}`);
      if (this._limit !== null) params.push(`limit=${this._limit}`);
      
      const finalHeaders: Record<string, string> = { ...headers };
      if (this._single) {
        finalHeaders.Accept = 'application/vnd.pgrst.object+json';
      }
      if (this._range) {
        finalHeaders.Range = `${this._range.from}-${this._range.to}`;
      }
        
      try {
        const res = await fetch(`${url}/rest/v1/${this._table}?${params.join('&')}`, { 
          method: 'GET',
          headers: finalHeaders,
        });
        if (!res.ok) {
          const errText = await res.text();
          // Handle 406 for single() when no rows found
          if (res.status === 406 && this._single) {
            return resolve({ data: null, error: this._maybeSingle ? null : { message: 'Row not found' } });
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
        single() {
          return {
            then: async (resolve: (v: unknown) => void) => {
              try {
                const selectParam = cols ? `?select=${encodeURIComponent(cols)}` : '';
                const res = await fetch(`${url}/rest/v1/${table}${selectParam}`, {
                  method,
                  headers: { ...headers, Prefer: 'return=representation', Accept: 'application/vnd.pgrst.object+json' },
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
        maybeSingle() {
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
                const arr = await res.json();
                return resolve({ data: Array.isArray(arr) ? (arr[0] ?? null) : arr, error: null });
              } catch (e: unknown) {
                return resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
              }
            }
          };
        },
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
        single() {
          return {
            then: async (resolve: (v: unknown) => void) => {
              const filterStr = builder._filters.length > 0 ? `?${builder._filters.join('&')}` : '';
              const selectParam = cols ? `${filterStr ? '&' : '?'}select=${encodeURIComponent(cols)}` : '';
              try {
                const res = await fetch(`${url}/rest/v1/${table}${filterStr}${selectParam}`, {
                  method: 'PATCH',
                  headers: { ...headers, Prefer: 'return=representation', Accept: 'application/vnd.pgrst.object+json' },
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
