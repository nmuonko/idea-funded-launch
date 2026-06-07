/**
 * create-partial-payment
 *
 * Creates a Stripe/pawaPay payment intent for either:
 *   - kind=deposit: 30% of order.total_usd (called from checkout when user chooses "Pay 30% deposit")
 *   - kind=balance: the remaining 70% (called from /orders/:id when the customer pays balance on arrival)
 *
 * Eligibility (server-enforced):
 *   - Order must belong to the calling user
 *   - Order must not contain a vehicle (contains_vehicle = false)
 *   - Order total_usd must be >= $100
 *
 * The function:
 *   - For deposit: marks order.payment_plan='deposit', sets deposit/balance amounts,
 *     balance_status='pending', and ensures order.status moves to PENDING_PAYMENT.
 *   - For balance: requires order.payment_plan='deposit' AND balance_status='pending'.
 *   - Inserts a payments row with kind = deposit | balance and reference suffix -DEP / -BAL.
 *   - Returns Stripe clientSecret OR pawaPay depositId so the frontend can complete payment.
 *
 * NOTE: Returns HTTP 200 with JSON errors to keep the mobile build resilient.
 */

import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/http.ts";
import {
  extractRequestToken,
  verifyAndGetUser,
  authErrorResponse,
  normalizeAuthErrorCode,
} from "../_shared/auth.ts";
import {
  createPaymentRecord,
  generatePaymentReference,
} from "../_shared/paymentProviders.ts";
import { createDeposit, getPawaPayConfig } from "../_shared/pawapayAdapter.ts";
import { createPaymentIntent, getStripeConfig } from "../_shared/stripeAdapter.ts";
import { resolveAndLogStripeKey } from "../_shared/stripeKeyResolver.ts";

const corsHeaders = getCorsHeaders();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Body {
  order_id: string;
  kind: "deposit" | "balance";
  provider?: "stripe" | "pawapay";
  phone?: string;
}

const MIN_ORDER_USD_FOR_DEPOSIT = 100;
const DEPOSIT_PCT = 0.30;

function roundUpCent(n: number): number {
  return Math.ceil(n * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();

  try {
    const { token, source } = await extractRequestToken(req);
    if (!token) {
      return authErrorResponse("NO_TOKEN", "Please sign in.", { requestId });
    }

    let user: any;
    try {
      const result = await verifyAndGetUser(req, undefined, { token, source });
      user = result.user;
    } catch (e: any) {
      const code = normalizeAuthErrorCode(e) || "INVALID_TOKEN";
      return authErrorResponse(code, undefined, { requestId });
    }

    const body: Body = await req.json().catch(() => ({} as Body));
    const { order_id, kind } = body;
    const requestedProvider = (body.provider || "").toLowerCase();
    const phone = body.phone;

    if (!order_id || (kind !== "deposit" && kind !== "balance")) {
      return json({ success: false, requestId, error: "order_id and kind (deposit|balance) are required", error_code: "BAD_REQUEST" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load order
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, user_id, status, total_usd, contains_vehicle, payment_plan, deposit_amount_usd, balance_amount_usd, balance_status",
      )
      .eq("id", order_id)
      .single();

    if (orderErr || !order) {
      return json({ success: false, requestId, error: "Order not found", error_code: "ORDER_NOT_FOUND" }, 200);
    }
    if (order.user_id !== user.id) {
      return json({ success: false, requestId, error: "Not authorized for this order", error_code: "NOT_AUTHORIZED" }, 200);
    }

    const totalUsd = Number(order.total_usd || 0);

    // === Eligibility checks ===
    if (order.contains_vehicle === true) {
      return json({
        success: false, requestId,
        error: "Deposit plan is not available for vehicle orders. Please pay in full.",
        error_code: "DEPOSIT_NOT_ALLOWED_VEHICLE",
      }, 200);
    }
    if (totalUsd < MIN_ORDER_USD_FOR_DEPOSIT) {
      return json({
        success: false, requestId,
        error: `Deposit plan requires an order of at least $${MIN_ORDER_USD_FOR_DEPOSIT}. Please pay in full.`,
        error_code: "DEPOSIT_NOT_ALLOWED_MIN",
      }, 200);
    }

    // Compute split deterministically from total_usd
    const depositUsd = roundUpCent(totalUsd * DEPOSIT_PCT);
    const balanceUsd = roundUpCent(totalUsd - depositUsd);

    // === Per-kind validation ===
    if (kind === "deposit") {
      if (order.status !== "DRAFT" && order.status !== "PENDING_PAYMENT") {
        return json({
          success: false, requestId,
          error: `Order is in ${order.status} status, cannot start a deposit payment.`,
          error_code: "INVALID_ORDER_STATUS",
        }, 200);
      }
    } else {
      // balance
      if (order.payment_plan !== "deposit") {
        return json({
          success: false, requestId,
          error: "This order was not placed on a deposit plan.",
          error_code: "NOT_DEPOSIT_ORDER",
        }, 200);
      }
      if (order.balance_status === "paid") {
        return json({
          success: false, requestId,
          error: "The balance for this order has already been paid.",
          error_code: "BALANCE_ALREADY_PAID",
        }, 200);
      }
    }

    const payable = kind === "deposit" ? depositUsd : Number(order.balance_amount_usd || balanceUsd);

    // === Persist deposit metadata on the order (idempotent for deposit) ===
    if (kind === "deposit") {
      const { error: updErr } = await supabase
        .from("orders")
        .update({
          payment_plan: "deposit",
          deposit_amount_usd: depositUsd,
          balance_amount_usd: balanceUsd,
          balance_status: "pending",
          status: "PENDING_PAYMENT",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order_id);
      if (updErr) {
        console.error("[create-partial-payment] failed to set deposit metadata", updErr);
        return json({ success: false, requestId, error: "Failed to record deposit plan", error_code: "DB_ERROR" }, 200);
      }
    }

    // === Provider selection ===
    // Default: same provider as the original payment, if known. Otherwise auto: stripe for >$5000 or no phone, else pawapay.
    let providerKey: "stripe" | "pawapay" = "stripe";

    if (requestedProvider === "stripe" || requestedProvider === "pawapay") {
      providerKey = requestedProvider;
    } else {
      // Look up the previous successful payment for this order to keep the same provider on balance.
      const { data: priorPayment } = await supabase
        .from("payments")
        .select("provider_key, status, kind")
        .eq("order_id", order_id)
        .order("created_at", { ascending: false })
        .limit(5);
      const lastSucceeded = (priorPayment || []).find((p) => p.status === "succeeded");
      if (lastSucceeded?.provider_key === "pawapay") providerKey = "pawapay";
      else providerKey = "stripe";
    }

    // Mobile money has limits ($5000 typical). Fall back to stripe if too large.
    if (providerKey === "pawapay" && payable > 5000) {
      providerKey = "stripe";
    }

    // Generate reference with kind suffix so webhooks can identify
    const refBase = generatePaymentReference(order_id);
    const reference = `${refBase}-${kind === "deposit" ? "DEP" : "BAL"}`;

    // === STRIPE ===
    if (providerKey === "stripe") {
      const keyResult = resolveAndLogStripeKey("create-partial-payment", undefined, {
        orderId: order_id, amountUsd: payable, requestId,
      });
      if (!keyResult.success || !keyResult.keyInfo) {
        return json({ success: false, requestId, error: "Card payments are not configured", error_code: "STRIPE_NOT_CONFIGURED" }, 200);
      }

      const { data: providerRecord } = await supabase
        .from("payment_providers")
        .select("*")
        .eq("provider_key", "stripe")
        .eq("is_enabled", true)
        .single();

      let stripeConfig;
      try {
        stripeConfig = getStripeConfig(providerRecord);
        stripeConfig.secretKey = keyResult.keyInfo.secretKey;
        stripeConfig.keyInfo = keyResult.keyInfo;
      } catch (e: any) {
        return json({ success: false, requestId, error: "Card payments are not configured", error_code: "STRIPE_NOT_CONFIGURED" }, 200);
      }

      const paymentRecord = await createPaymentRecord(supabase, {
        order_id, provider_key: "stripe",
        amount: payable, currency: "USD",
        reference, country: "ALL", status: "pending",
        kind,
      });
      if (!paymentRecord) {
        return json({ success: false, requestId, error: "Failed to create payment record", error_code: "DB_ERROR" }, 200);
      }

      const stripeResult = await createPaymentIntent(stripeConfig, {
        orderId: order_id,
        userId: user.id,
        intentId: paymentRecord.id,
        amount: payable,
        description: `AfriShop ${order_id.slice(0, 8)} (${kind === "deposit" ? "30% deposit" : "70% balance"})`,
      });

      if (!stripeResult.success || !stripeResult.client_secret) {
        return json({ success: false, requestId, error: stripeResult.error || "Stripe failed", error_code: "STRIPE_ERROR" }, 200);
      }

      await supabase.from("payments").update({
        provider_deposit_id: stripeResult.provider_deposit_id,
        client_secret: stripeResult.client_secret,
        raw_request: stripeResult.raw_request,
      }).eq("id", paymentRecord.id);

      return json({
        success: true, requestId,
        provider: "stripe",
        kind,
        amount: payable,
        currency: "USD",
        order_id,
        intentId: paymentRecord.id,
        clientSecret: stripeResult.client_secret,
        nextAction: { type: "PAYMENT_SHEET", clientSecret: stripeResult.client_secret },
      });
    }

    // === PAWAPAY ===
    if (providerKey === "pawapay") {
      // Resolve phone (deposit may pass it, balance falls back to profile)
      let resolvedPhone = (phone || "").trim();
      if (!resolvedPhone) {
        const { data: profile } = await supabase.from("profiles").select("phone").eq("user_id", user.id).single();
        resolvedPhone = (profile?.phone || "").trim();
      }
      if (!resolvedPhone) {
        return json({ success: false, requestId, error: "Phone is required for mobile money payments", error_code: "PHONE_REQUIRED" }, 200);
      }
      const normalized = resolvedPhone.replace(/[\s\-\+\(\)]/g, "");
      let e164 = normalized;
      if (normalized.startsWith("243")) e164 = normalized;
      else if (normalized.startsWith("0")) e164 = "243" + normalized.slice(1);
      else e164 = "243" + normalized;

      let pawaConfig;
      try { pawaConfig = getPawaPayConfig(); }
      catch { return json({ success: false, requestId, error: "Mobile money not configured", error_code: "PAWAPAY_NOT_CONFIGURED" }, 200); }

      const paymentRecord = await createPaymentRecord(supabase, {
        order_id, provider_key: "pawapay",
        amount: payable, currency: "USD",
        reference, customer_phone: e164, status: "pending",
        kind,
      });
      if (!paymentRecord) {
        return json({ success: false, requestId, error: "Failed to create payment record", error_code: "DB_ERROR" }, 200);
      }

      const depositResult = await createDeposit(pawaConfig, {
        orderId: order_id,
        amount: payable,
        currency: "USD",
        customerPhone: e164,
        customerEmail: user.email || "",
        reference,
        description: `AfriShop ${order_id.slice(0, 8)} (${kind === "deposit" ? "30% deposit" : "70% balance"})`,
      });

      if (!depositResult.success) {
        return json({
          success: false, requestId,
          error: depositResult.error || "Mobile money payment failed",
          error_code: "PAWAPAY_ERROR",
        }, 200);
      }

      await supabase.from("payments").update({
        provider_deposit_id: depositResult.provider_deposit_id,
      }).eq("id", paymentRecord.id);

      return json({
        success: true, requestId,
        provider: "pawapay",
        kind,
        amount: payable,
        currency: "USD",
        order_id,
        depositId: depositResult.provider_deposit_id,
        payment_flow: "PAWAPAY",
        status: "pending_user_confirmation",
        message: "Payment request sent to your phone. Please confirm.",
        message_fr: "Demande de paiement envoyée à votre téléphone. Veuillez confirmer.",
      });
    }

    return json({ success: false, requestId, error: "No suitable payment provider", error_code: "NO_PROVIDER" }, 200);
  } catch (e: any) {
    console.error("[create-partial-payment] fatal", e);
    return json({ success: false, requestId, error: e?.message || "Internal error", error_code: "INTERNAL_ERROR" }, 200);
  }
});
