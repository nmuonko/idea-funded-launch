// Lightweight auth/cron/admin guards reusable across edge functions.
// Kept dependency-free (uses fetch + GoTrue REST) to avoid bundle bloat.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

export class GuardError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!h) return null;
  const parts = h.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") return parts[1];
  return null;
}

export function isServiceRoleRequest(req: Request): boolean {
  const token = extractBearer(req);
  return !!token && !!SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY;
}

export function isCronRequest(req: Request): boolean {
  const cron = req.headers.get("x-cron-secret");
  return !!CRON_SECRET && !!cron && cron === CRON_SECRET;
}

export async function requireAuthenticatedUser(req: Request): Promise<{ id: string; email?: string }> {
  const token = extractBearer(req);
  if (!token) throw new GuardError("Missing Authorization header", 401);
  // Treat the project anon key alone as unauthenticated.
  if (token === ANON_KEY) throw new GuardError("User authentication required", 401);
  // Service role bypasses user check.
  if (token === SERVICE_ROLE_KEY) return { id: "service_role" };

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  if (!res.ok) throw new GuardError("Invalid or expired token", 401);
  const user = await res.json();
  if (!user?.id) throw new GuardError("Invalid token", 401);
  return { id: user.id, email: user.email };
}

export async function userIsAdmin(userId: string): Promise<boolean> {
  if (userId === "service_role") return true;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&role=eq.admin&select=role`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

export async function requireAdmin(req: Request): Promise<{ id: string }> {
  if (isServiceRoleRequest(req)) return { id: "service_role" };
  const user = await requireAuthenticatedUser(req);
  const ok = await userIsAdmin(user.id);
  if (!ok) throw new GuardError("Admin privileges required", 403);
  return { id: user.id };
}

export async function requireAdminOrCron(req: Request): Promise<{ source: string }> {
  if (isCronRequest(req)) return { source: "cron" };
  if (isServiceRoleRequest(req)) return { source: "service_role" };
  const user = await requireAuthenticatedUser(req);
  const ok = await userIsAdmin(user.id);
  if (!ok) throw new GuardError("Admin or cron secret required", 403);
  return { source: `admin:${user.id}` };
}

export function guardErrorResponse(err: unknown, corsHeaders: Record<string, string>): Response {
  const status = err instanceof GuardError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Unauthorized";
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
