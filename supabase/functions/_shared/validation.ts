/**
 * Lightweight Validation Helpers
 * Replaces Zod to avoid bundle bloat
 */

/**
 * Require a string value or throw
 */
export function requireString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`BAD_REQUEST: ${name} is required`);
  }
  return v.trim();
}

/**
 * Require a number value or throw
 */
export function requireNumber(v: unknown, name: string): number {
  const num = typeof v === "number" ? v : parseFloat(String(v));
  if (isNaN(num)) {
    throw new Error(`BAD_REQUEST: ${name} must be a number`);
  }
  return num;
}

/**
 * Require a positive number or throw
 */
export function requirePositiveNumber(v: unknown, name: string): number {
  const num = requireNumber(v, name);
  if (num <= 0) {
    throw new Error(`BAD_REQUEST: ${name} must be positive`);
  }
  return num;
}

/**
 * Require an integer or throw
 */
export function requireInt(v: unknown, name: string): number {
  const num = requireNumber(v, name);
  if (!Number.isInteger(num)) {
    throw new Error(`BAD_REQUEST: ${name} must be an integer`);
  }
  return num;
}

/**
 * Optional string (returns undefined if missing/empty)
 */
export function optionalString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed || undefined;
}

/**
 * Optional number (returns undefined if missing/invalid)
 */
export function optionalNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const num = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(num) ? undefined : num;
}

/**
 * Optional integer (returns undefined if missing/invalid)
 */
export function optionalInt(v: unknown): number | undefined {
  const num = optionalNumber(v);
  if (num === undefined) return undefined;
  return Number.isInteger(num) ? num : undefined;
}

/**
 * Coerce to boolean
 */
export function toBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return Boolean(v);
}

/**
 * Require one of allowed values
 */
export function requireOneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  const str = requireString(v, name);
  if (!allowed.includes(str as T)) {
    throw new Error(`BAD_REQUEST: ${name} must be one of: ${allowed.join(", ")}`);
  }
  return str as T;
}

/**
 * Optional one of allowed values
 */
export function optionalOneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const str = optionalString(v);
  if (!str) return undefined;
  return allowed.includes(str as T) ? str as T : undefined;
}

/**
 * Require a valid URL or throw
 */
export function requireUrl(v: unknown, name: string): string {
  const str = requireString(v, name);
  try {
    new URL(str);
    return str;
  } catch {
    throw new Error(`BAD_REQUEST: ${name} must be a valid URL`);
  }
}

/**
 * Require a valid email or throw
 */
export function requireEmail(v: unknown, name: string): string {
  const str = requireString(v, name);
  // Simple email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(str)) {
    throw new Error(`BAD_REQUEST: ${name} must be a valid email`);
  }
  return str;
}

/**
 * Require a valid UUID or throw
 */
export function requireUuid(v: unknown, name: string): string {
  const str = requireString(v, name);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(str)) {
    throw new Error(`BAD_REQUEST: ${name} must be a valid UUID`);
  }
  return str;
}

/**
 * Parse JSON body or throw
 */
export async function parseJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    throw new Error("BAD_REQUEST: Invalid JSON body");
  }
}

/**
 * Validate request body against a schema-like object
 * Returns validated data or throws
 */
export function validateBody<T>(
  body: Record<string, unknown>,
  schema: Record<keyof T, "string" | "number" | "boolean" | "optional_string" | "optional_number">
): T {
  const result: Record<string, unknown> = {};
  
  for (const [key, type] of Object.entries(schema)) {
    const value = body[key];
    
    switch (type) {
      case "string":
        result[key] = requireString(value, key);
        break;
      case "number":
        result[key] = requireNumber(value, key);
        break;
      case "boolean":
        result[key] = toBoolean(value);
        break;
      case "optional_string":
        result[key] = optionalString(value);
        break;
      case "optional_number":
        result[key] = optionalNumber(value);
        break;
    }
  }
  
  return result as T;
}
