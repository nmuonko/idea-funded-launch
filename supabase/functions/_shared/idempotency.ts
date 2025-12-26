/**
 * Idempotency Helper
 * Generates cart hashes and manages payment attempts for idempotency
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PaymentAttempt {
  id: string;
  user_id: string;
  order_id: string | null;
  checkout_session_id: string | null;
  idempotency_key: string;
  status: string;
  amount: number;
  currency: string;
  cart_hash: string;
  expires_at: string;
  created_at: string;
}

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  existingAttempt?: PaymentAttempt;
  existingOrder?: {
    id: string;
    status: string;
    total_usd: number;
  };
  existingSession?: {
    id: string;
    status: string;
    redirect_url?: string;
  };
}

/**
 * Generate cart hash from order using RPC function
 * This ensures server-side computation of the hash
 */
export async function generateCartHash(
  supabase: SupabaseClient,
  orderId: string,
  currency: string,
  paymentMethod: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('generate_cart_hash_from_order', {
    p_order_id: orderId,
    p_currency: currency,
    p_payment_method: paymentMethod,
  });

  if (error) {
    console.error('[Idempotency] Failed to generate cart hash:', error);
    return null;
  }

  return data as string;
}

/**
 * Check for existing valid payment attempt with the same cart hash
 * Returns the existing attempt if found and still valid (not expired)
 */
export async function checkExistingPaymentAttempt(
  supabase: SupabaseClient,
  userId: string,
  cartHash: string
): Promise<IdempotencyCheckResult> {
  // Look for existing payment attempt with same cart hash within last 30 minutes
  const { data: existingAttempt, error: attemptError } = await supabase
    .from('payment_attempts')
    .select('*')
    .eq('user_id', userId)
    .eq('cart_hash', cartHash)
    .in('status', ['pending', 'processing', 'paid'])
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (attemptError) {
    console.error('[Idempotency] Error checking existing attempt:', attemptError);
    return { isDuplicate: false };
  }

  if (!existingAttempt) {
    return { isDuplicate: false };
  }

  // Found existing attempt - fetch related data
  const result: IdempotencyCheckResult = {
    isDuplicate: true,
    existingAttempt: existingAttempt as PaymentAttempt,
  };

  // Fetch order if exists
  if (existingAttempt.order_id) {
    const { data: order } = await supabase
      .from('orders')
      .select('id, status, total_usd')
      .eq('id', existingAttempt.order_id)
      .maybeSingle();

    if (order) {
      result.existingOrder = order;
    }
  }

  // Fetch checkout session if exists
  if (existingAttempt.checkout_session_id) {
    const { data: session } = await supabase
      .from('checkout_sessions')
      .select('id, status, redirect_url')
      .eq('id', existingAttempt.checkout_session_id)
      .maybeSingle();

    if (session) {
      result.existingSession = session;
    }
  }

  return result;
}

/**
 * Create a new payment attempt record
 */
export async function createPaymentAttempt(
  supabase: SupabaseClient,
  params: {
    userId: string;
    orderId?: string;
    checkoutSessionId?: string;
    cartHash: string;
    amount: number;
    currency: string;
    paymentMethod: string;
  }
): Promise<PaymentAttempt | null> {
  // Generate idempotency key from cart hash + timestamp
  const timestamp = Date.now().toString(36);
  const idempotencyKey = `${params.cartHash.substring(0, 16)}-${timestamp}`;

  const { data, error } = await supabase
    .from('payment_attempts')
    .insert({
      user_id: params.userId,
      order_id: params.orderId || null,
      checkout_session_id: params.checkoutSessionId || null,
      idempotency_key: idempotencyKey,
      cart_hash: params.cartHash,
      amount: params.amount,
      currency: params.currency,
      payment_method: params.paymentMethod,
      status: 'pending',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
    })
    .select()
    .single();

  if (error) {
    console.error('[Idempotency] Failed to create payment attempt:', error);
    return null;
  }

  return data as PaymentAttempt;
}

/**
 * Update payment attempt with order and session IDs
 */
export async function updatePaymentAttempt(
  supabase: SupabaseClient,
  attemptId: string,
  updates: {
    orderId?: string;
    checkoutSessionId?: string;
    status?: string;
    providerRef?: string;
    lastError?: string;
  }
): Promise<boolean> {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.orderId) updateData.order_id = updates.orderId;
  if (updates.checkoutSessionId) updateData.checkout_session_id = updates.checkoutSessionId;
  if (updates.status) updateData.status = updates.status;
  if (updates.providerRef) updateData.provider_ref = updates.providerRef;
  if (updates.lastError) updateData.last_error = updates.lastError;

  const { error } = await supabase
    .from('payment_attempts')
    .update(updateData)
    .eq('id', attemptId);

  if (error) {
    console.error('[Idempotency] Failed to update payment attempt:', error);
    return false;
  }

  return true;
}
