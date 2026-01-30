/**
 * Provider Budget Controller
 * Manages API call budgets for cost control
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { BudgetWindow } from "./catalogSettings.ts";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface BudgetStatus {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  windowKey: string;
  windowStart?: Date;
}

export type AmazonStatus = 
  | "live"           // Fresh live call
  | "cached"         // Served from cache
  | "budget_exceeded" // Budget limit hit
  | "disabled"       // Provider disabled
  | "cap_exhausted"  // Per-query cap hit
  | "error";         // API error

// ─── CHECK BUDGET ─────────────────────────────────────────────────────────────

/**
 * Check if budget allows a call (without incrementing)
 */
export async function checkBudget(
  supabase: SupabaseClient,
  provider: string,
  windowType: BudgetWindow,
  limit: number,
  requestId: string
): Promise<BudgetStatus> {
  const { data, error } = await supabase
    .rpc("check_provider_budget", {
      p_provider: provider,
      p_window_type: windowType,
      p_limit: limit,
    });

  if (error) {
    console.error(`[AMAZON_BUDGET] requestId=${requestId} check error=${error.message}`);
    // On error, assume allowed to not block operations
    return {
      allowed: true,
      count: 0,
      limit,
      remaining: limit,
      windowKey: "error",
    };
  }

  const result = data as Record<string, unknown>;
  const status: BudgetStatus = {
    allowed: result.allowed as boolean,
    count: result.count as number,
    limit: result.limit as number,
    remaining: result.remaining as number,
    windowKey: result.window_key as string,
  };

  console.log(`[AMAZON_BUDGET] requestId=${requestId} check count=${status.count}/${status.limit} remaining=${status.remaining}`);
  return status;
}

// ─── INCREMENT BUDGET ─────────────────────────────────────────────────────────

/**
 * Increment budget count (call after successful API call)
 */
export async function incrementBudget(
  supabase: SupabaseClient,
  provider: string,
  windowType: BudgetWindow,
  limit: number,
  requestId: string
): Promise<BudgetStatus> {
  const { data, error } = await supabase
    .rpc("increment_provider_budget", {
      p_provider: provider,
      p_window_type: windowType,
      p_limit: limit,
    });

  if (error) {
    console.error(`[AMAZON_BUDGET] requestId=${requestId} increment error=${error.message}`);
    return {
      allowed: true,
      count: 0,
      limit,
      remaining: limit,
      windowKey: "error",
    };
  }

  const result = data as Record<string, unknown>;
  const status: BudgetStatus = {
    allowed: result.allowed as boolean,
    count: result.count as number,
    limit: result.limit as number,
    remaining: result.remaining as number,
    windowKey: result.window_key as string,
  };

  console.log(`[AMAZON_BUDGET] requestId=${requestId} increment count=${status.count}/${status.limit} remaining=${status.remaining}`);
  return status;
}

// ─── AMAZON STATUS RESOLVER ───────────────────────────────────────────────────

export interface AmazonStatusInfo {
  status: AmazonStatus;
  budgetRemaining: number | null;
  cacheHit: boolean;
  returned: number;
  cap: number;
}

/**
 * Resolve Amazon status based on conditions
 */
export function resolveAmazonStatus(params: {
  enabled: boolean;
  budgetAllowed: boolean;
  budgetRemaining: number;
  cacheHit: boolean;
  queryCapHit: boolean;
  returned: number;
  cap: number;
  errorOccurred?: boolean;
}): AmazonStatusInfo {
  const { enabled, budgetAllowed, budgetRemaining, cacheHit, queryCapHit, returned, cap, errorOccurred } = params;

  if (!enabled) {
    return {
      status: "disabled",
      budgetRemaining: null,
      cacheHit: false,
      returned: 0,
      cap,
    };
  }

  if (errorOccurred) {
    return {
      status: "error",
      budgetRemaining,
      cacheHit,
      returned,
      cap,
    };
  }

  if (queryCapHit) {
    return {
      status: "cap_exhausted",
      budgetRemaining,
      cacheHit,
      returned,
      cap,
    };
  }

  if (!budgetAllowed) {
    return {
      status: "budget_exceeded",
      budgetRemaining: 0,
      cacheHit,
      returned,
      cap,
    };
  }

  if (cacheHit) {
    return {
      status: "cached",
      budgetRemaining,
      cacheHit: true,
      returned,
      cap,
    };
  }

  return {
    status: "live",
    budgetRemaining,
    cacheHit: false,
    returned,
    cap,
  };
}
