/**
 * Lightweight PostgREST Query Builder
 * 
 * SDK-free implementation using direct REST API calls.
 * Supports chaining: select(), eq(), neq(), ilike(), like(), in(), is(),
 * gte(), lte(), gt(), lt(), or(), order(), range(), limit(), single(), maybeSingle()
 * 
 * Mutation: insert(), update(), upsert(), delete()
 * Execute with: execute() returning { data, error, status, count? }
 */

export interface PostgrestResult<T = unknown> {
  data: T | null;
  error: PostgrestError | null;
  status: number;
  count?: number;
}

export interface PostgrestError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface PostgrestClientConfig {
  baseUrl: string;      // e.g., https://xxx.supabase.co/rest/v1
  apiKey: string;       // SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY
  jwt?: string;         // Bearer token from request (for RLS)
}

// ─── QUERY BUILDER ──────────────────────────────────────────────────────────

export class PostgrestQueryBuilder<T = unknown> {
  private _table: string;
  private _columns: string = "*";
  private _filters: string[] = [];
  private _orders: string[] = [];
  private _limitVal: number | null = null;
  private _offsetVal: number | null = null;
  private _singleMode: "single" | "maybeSingle" | null = null;
  private _countMode: "exact" | "planned" | "estimated" | null = null;
  private _method: "GET" | "POST" | "PATCH" | "DELETE" = "GET";
  private _body: unknown = null;
  private _upsertConflict: string | null = null;
  private _returnRepresentation = false;
  
  constructor(
    private config: PostgrestClientConfig,
    table: string
  ) {
    this._table = table;
  }
  
  // ─── SELECT METHODS ─────────────────────────────────────────────────────────
  
  select(columns = "*"): this {
    this._columns = columns;
    this._method = "GET";
    return this;
  }
  
  // ─── FILTER METHODS ─────────────────────────────────────────────────────────
  
  eq(column: string, value: unknown): this {
    this._filters.push(`${column}=eq.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  neq(column: string, value: unknown): this {
    this._filters.push(`${column}=neq.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  gt(column: string, value: unknown): this {
    this._filters.push(`${column}=gt.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  gte(column: string, value: unknown): this {
    this._filters.push(`${column}=gte.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  lt(column: string, value: unknown): this {
    this._filters.push(`${column}=lt.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  lte(column: string, value: unknown): this {
    this._filters.push(`${column}=lte.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  like(column: string, pattern: string): this {
    this._filters.push(`${column}=like.${encodeURIComponent(pattern)}`);
    return this;
  }
  
  ilike(column: string, pattern: string): this {
    this._filters.push(`${column}=ilike.${encodeURIComponent(pattern)}`);
    return this;
  }
  
  is(column: string, value: boolean | null): this {
    const v = value === null ? "null" : value ? "true" : "false";
    this._filters.push(`${column}=is.${v}`);
    return this;
  }
  
  in(column: string, values: unknown[]): this {
    const encoded = values.map(v => encodeURIComponent(String(v))).join(",");
    this._filters.push(`${column}=in.(${encoded})`);
    return this;
  }
  
  contains(column: string, value: unknown): this {
    this._filters.push(`${column}=cs.${encodeURIComponent(JSON.stringify(value))}`);
    return this;
  }
  
  containedBy(column: string, value: unknown): this {
    this._filters.push(`${column}=cd.${encodeURIComponent(JSON.stringify(value))}`);
    return this;
  }
  
  /**
   * OR filter - supports:
   * - .or("a.eq.1,b.eq.2") - raw string
   * - .or("(a.eq.1,b.eq.2)") - with parens (auto-stripped)
   */
  or(conditions: string): this {
    // Strip outer parens if provided
    let clean = conditions.trim();
    if (clean.startsWith("(") && clean.endsWith(")")) {
      clean = clean.slice(1, -1);
    }
    this._filters.push(`or=(${clean})`);
    return this;
  }
  
  /**
   * Filter (alias for backwards compatibility)
   */
  filter(column: string, operator: string, value: unknown): this {
    this._filters.push(`${column}=${operator}.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  // ─── ORDER METHODS ──────────────────────────────────────────────────────────
  
  /**
   * Order by column - supports multiple chained calls
   */
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const direction = options?.ascending === false ? "desc" : "asc";
    let orderStr = `${column}.${direction}`;
    
    if (options?.nullsFirst !== undefined) {
      orderStr += options.nullsFirst ? ".nullsfirst" : ".nullslast";
    }
    
    this._orders.push(orderStr);
    return this;
  }
  
  // ─── PAGINATION METHODS ─────────────────────────────────────────────────────
  
  limit(count: number): this {
    this._limitVal = count;
    return this;
  }
  
  range(from: number, to: number): this {
    this._offsetVal = from;
    this._limitVal = to - from + 1;
    return this;
  }
  
  // ─── SINGLE ROW METHODS ─────────────────────────────────────────────────────
  
  single(): this {
    this._singleMode = "single";
    return this;
  }
  
  maybeSingle(): this {
    this._singleMode = "maybeSingle";
    return this;
  }
  
  // ─── COUNT METHODS ──────────────────────────────────────────────────────────
  
  /**
   * Request count in response
   * Mode: exact | planned | estimated
   */
  count(mode: "exact" | "planned" | "estimated" = "exact"): this {
    this._countMode = mode;
    return this;
  }
  
  // ─── MUTATION METHODS ───────────────────────────────────────────────────────
  
  insert(rows: unknown): PostgrestMutationBuilder<T> {
    const builder = new PostgrestMutationBuilder<T>(this.config, this._table, "POST", rows);
    return builder;
  }
  
  update(data: unknown): PostgrestMutationBuilder<T> {
    const builder = new PostgrestMutationBuilder<T>(this.config, this._table, "PATCH", data);
    // Copy filters to mutation builder
    builder._filters = [...this._filters];
    return builder;
  }
  
  upsert(rows: unknown, options?: { onConflict?: string }): PostgrestMutationBuilder<T> {
    const builder = new PostgrestMutationBuilder<T>(this.config, this._table, "POST", rows, true);
    if (options?.onConflict) {
      builder._upsertConflict = options.onConflict;
    }
    return builder;
  }
  
  delete(): PostgrestMutationBuilder<T> {
    const builder = new PostgrestMutationBuilder<T>(this.config, this._table, "DELETE", null);
    builder._filters = [...this._filters];
    return builder;
  }
  
  // ─── EXECUTE ────────────────────────────────────────────────────────────────
  
  async execute(): Promise<PostgrestResult<T>> {
    const params: string[] = [];
    
    // Add select columns
    params.push(`select=${encodeURIComponent(this._columns)}`);
    
    // Add filters
    params.push(...this._filters);
    
    // Add orders (multiple allowed)
    if (this._orders.length > 0) {
      params.push(`order=${this._orders.join(",")}`);
    }
    
    // Add limit
    if (this._limitVal !== null) {
      params.push(`limit=${this._limitVal}`);
    }
    
    // Add offset
    if (this._offsetVal !== null) {
      params.push(`offset=${this._offsetVal}`);
    }
    
    const url = `${this.config.baseUrl}/${this._table}?${params.join("&")}`;
    
    const headers: Record<string, string> = {
      "apikey": this.config.apiKey,
      "Authorization": `Bearer ${this.config.jwt || this.config.apiKey}`,
      "Content-Type": "application/json",
    };
    
    // Single row mode
    if (this._singleMode) {
      headers["Accept"] = "application/vnd.pgrst.object+json";
    }
    
    // Count mode
    if (this._countMode) {
      headers["Prefer"] = `count=${this._countMode}`;
    }
    
    try {
      const res = await fetch(url, { method: "GET", headers });
      
      // Handle 406 for maybeSingle when no rows
      if (res.status === 406 && this._singleMode === "maybeSingle") {
        return { data: null, error: null, status: 200 };
      }
      
      if (!res.ok) {
        const errText = await res.text();
        let errObj: PostgrestError;
        try {
          errObj = JSON.parse(errText);
        } catch {
          errObj = { message: errText.substring(0, 200) };
        }
        return { data: null, error: errObj, status: res.status };
      }
      
      const data = await res.json() as T;
      
      // Parse count from Content-Range header
      let count: number | undefined;
      if (this._countMode) {
        const contentRange = res.headers.get("Content-Range");
        if (contentRange) {
          const match = contentRange.match(/\/(\d+|\*)/);
          if (match && match[1] !== "*") {
            count = parseInt(match[1], 10);
          }
        }
      }
      
      return { data, error: null, status: res.status, count };
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
        status: 0,
      };
    }
  }
  
  // ─── PROMISE-LIKE INTERFACE ─────────────────────────────────────────────────
  
  then<TResult1 = PostgrestResult<T>, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ─── MUTATION BUILDER ─────────────────────────────────────────────────────────

export class PostgrestMutationBuilder<T = unknown> {
  _filters: string[] = [];
  _upsertConflict: string | null = null;
  private _selectCols: string | null = null;
  
  constructor(
    private config: PostgrestClientConfig,
    private _table: string,
    private _method: "POST" | "PATCH" | "DELETE",
    private _body: unknown,
    private _isUpsert = false
  ) {}
  
  // Filter methods for update/delete
  eq(column: string, value: unknown): this {
    this._filters.push(`${column}=eq.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  neq(column: string, value: unknown): this {
    this._filters.push(`${column}=neq.${encodeURIComponent(String(value))}`);
    return this;
  }
  
  in(column: string, values: unknown[]): this {
    const encoded = values.map(v => encodeURIComponent(String(v))).join(",");
    this._filters.push(`${column}=in.(${encoded})`);
    return this;
  }
  
  is(column: string, value: boolean | null): this {
    const v = value === null ? "null" : value ? "true" : "false";
    this._filters.push(`${column}=is.${v}`);
    return this;
  }
  
  // Select columns to return
  select(columns = "*"): this {
    this._selectCols = columns;
    return this;
  }
  
  async execute(): Promise<PostgrestResult<T>> {
    const params: string[] = [];
    
    // Add filters
    params.push(...this._filters);
    
    // Add select if specified
    if (this._selectCols) {
      params.push(`select=${encodeURIComponent(this._selectCols)}`);
    }
    
    // Add upsert conflict columns
    if (this._isUpsert && this._upsertConflict) {
      params.push(`on_conflict=${this._upsertConflict}`);
    }
    
    const queryStr = params.length > 0 ? `?${params.join("&")}` : "";
    const url = `${this.config.baseUrl}/${this._table}${queryStr}`;
    
    const headers: Record<string, string> = {
      "apikey": this.config.apiKey,
      "Authorization": `Bearer ${this.config.jwt || this.config.apiKey}`,
      "Content-Type": "application/json",
    };
    
    // Set Prefer header for upsert or return representation
    const preferParts: string[] = [];
    if (this._isUpsert) {
      preferParts.push("resolution=merge-duplicates");
    }
    if (this._selectCols !== null || this._method !== "DELETE") {
      preferParts.push("return=representation");
    }
    if (preferParts.length > 0) {
      headers["Prefer"] = preferParts.join(",");
    }
    
    try {
      const res = await fetch(url, {
        method: this._method,
        headers,
        body: this._body !== null ? JSON.stringify(this._body) : undefined,
      });
      
      if (!res.ok) {
        const errText = await res.text();
        let errObj: PostgrestError;
        try {
          errObj = JSON.parse(errText);
        } catch {
          errObj = { message: errText.substring(0, 200) };
        }
        return { data: null, error: errObj, status: res.status };
      }
      
      // DELETE may return empty body
      const text = await res.text();
      const data = text ? (JSON.parse(text) as T) : null;
      
      return { data, error: null, status: res.status };
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
        status: 0,
      };
    }
  }
  
  // Promise-like interface
  then<TResult1 = PostgrestResult<T>, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ─── RPC BUILDER ──────────────────────────────────────────────────────────────

export class PostgrestRpcBuilder<T = unknown> {
  constructor(
    private config: PostgrestClientConfig,
    private _fn: string,
    private _params: Record<string, unknown> = {}
  ) {}
  
  async execute(): Promise<PostgrestResult<T>> {
    const url = `${this.config.baseUrl}/rpc/${this._fn}`;
    
    const headers: Record<string, string> = {
      "apikey": this.config.apiKey,
      "Authorization": `Bearer ${this.config.jwt || this.config.apiKey}`,
      "Content-Type": "application/json",
    };
    
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(this._params),
      });
      
      if (!res.ok) {
        const errText = await res.text();
        let errObj: PostgrestError;
        try {
          errObj = JSON.parse(errText);
        } catch {
          errObj = { message: errText.substring(0, 200) };
        }
        return { data: null, error: errObj, status: res.status };
      }
      
      const data = await res.json() as T;
      return { data, error: null, status: res.status };
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
        status: 0,
      };
    }
  }
  
  then<TResult1 = PostgrestResult<T>, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ─── MAIN CLIENT ──────────────────────────────────────────────────────────────

export class PostgrestClient {
  private config: PostgrestClientConfig;
  
  constructor(config: PostgrestClientConfig) {
    this.config = config;
  }
  
  from<T = unknown>(table: string): PostgrestQueryBuilder<T> {
    return new PostgrestQueryBuilder<T>(this.config, table);
  }
  
  rpc<T = unknown>(fn: string, params?: Record<string, unknown>): PostgrestRpcBuilder<T> {
    return new PostgrestRpcBuilder<T>(this.config, fn, params);
  }
  
  /**
   * Auth helper - verify JWT and get user
   */
  async getUser(token?: string): Promise<PostgrestResult<{ user: unknown }>> {
    const baseUrl = this.config.baseUrl.replace("/rest/v1", "");
    const authToken = token || this.config.jwt || this.config.apiKey;
    
    try {
      const res = await fetch(`${baseUrl}/auth/v1/user`, {
        headers: {
          "apikey": this.config.apiKey,
          "Authorization": `Bearer ${authToken}`,
        },
      });
      
      if (!res.ok) {
        return {
          data: null,
          error: { message: `Auth error: ${res.status}` },
          status: res.status,
        };
      }
      
      const user = await res.json();
      return { data: { user }, error: null, status: res.status };
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
        status: 0,
      };
    }
  }
}

// ─── FACTORY FUNCTION ─────────────────────────────────────────────────────────

/**
 * Create a PostgrestClient configured for the current environment
 */
export function createPostgrestClient(jwt?: string): PostgrestClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL not configured");
  }
  
  const apiKey = serviceRoleKey || anonKey;
  if (!apiKey) {
    throw new Error("No API key available (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)");
  }
  
  return new PostgrestClient({
    baseUrl: `${supabaseUrl}/rest/v1`,
    apiKey,
    jwt,
  });
}

/**
 * Create a PostgrestClient for admin operations (service role)
 */
export function createAdminPostgrestClient(): PostgrestClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  
  return new PostgrestClient({
    baseUrl: `${supabaseUrl}/rest/v1`,
    apiKey: serviceRoleKey,
  });
}

/**
 * Get DB client from request - extracts JWT from Authorization header
 */
export function getDbClient(req: Request): PostgrestClient {
  const authHeader = req.headers.get("Authorization");
  let jwt: string | undefined;
  
  if (authHeader?.startsWith("Bearer ")) {
    jwt = authHeader.slice(7);
  }
  
  return createPostgrestClient(jwt);
}
