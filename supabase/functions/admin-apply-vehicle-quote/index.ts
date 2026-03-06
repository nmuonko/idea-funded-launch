import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Normalize URL for duplicate detection - strip query params, trailing slashes
 */
function normalizeProductUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    let path = u.pathname.toLowerCase().replace(/\/+$/, '');
    return `https://${host}${path}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Admin Apply Vehicle Quote - ATOMIC & IDEMPOTENT
 * 
 * Stores vehicle quote with full price breakdown: base price, shipping, margin, total.
 * Updates quote_requests, order_items, and recalculates order totals atomically.
 * Triggers email notification to customer.
 * 
 * POST /admin-apply-vehicle-quote
 * Body: {
 *   quoteRequestId: string,
 *   quotedShippingUsd: number,   // Shipping cost entered by admin
 *   quotedTotalUsd: number,      // Total price (base + shipping + margin)
 *   quotedMarginUsd?: number,    // Optional - margin breakdown
 *   basePriceUsd?: number,       // Optional - vehicle base price
 *   adminNotes?: string
 * }
 */

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleData) {
      return new Response(
        JSON.stringify({ success: false, error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await req.json();
    const { quoteRequestId, quotedShippingUsd, quotedTotalUsd, quotedMarginUsd, basePriceUsd, adminNotes } = body;

    if (!quoteRequestId || quotedShippingUsd === undefined || quotedTotalUsd === undefined) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: quoteRequestId, quotedShippingUsd, quotedTotalUsd" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse as numbers and validate
    const shippingValue = typeof quotedShippingUsd === 'number' 
      ? quotedShippingUsd 
      : parseFloat(String(quotedShippingUsd).replace(/,/g, ''));
    const totalValue = typeof quotedTotalUsd === 'number' 
      ? quotedTotalUsd 
      : parseFloat(String(quotedTotalUsd).replace(/,/g, ''));

    if (!Number.isFinite(shippingValue) || !Number.isFinite(totalValue)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid shipping or total values - must be valid numbers" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (shippingValue < 0 || totalValue < 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Values must be positive" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Round shipping to 2 decimal places
    const finalShippingUsd = Math.round(shippingValue * 100) / 100;
    // NOTE: finalTotalUsd will be recalculated below using authoritative backend margin

    console.log("[admin-apply-vehicle-quote] APPLYING QUOTE:", { 
      quoteRequestId, 
      inputShipping: quotedShippingUsd,
      inputTotal: quotedTotalUsd,
      inputMargin: quotedMarginUsd,
      inputBasePrice: basePriceUsd,
      finalShippingUsd,
      note: "Total and margin will be recalculated by backend",
      adminId: user.id
    });

    // 1. Fetch the quote request
    const { data: quoteCheck, error: checkError } = await supabase
      .from("quote_requests")
      .select("id, order_item_id, user_id, title, product_url, store_name, locale, customer_email")
      .eq("id", quoteRequestId)
      .maybeSingle();

    if (checkError) {
      console.error("[admin-apply-vehicle-quote] Error checking quote:", checkError);
      return new Response(
        JSON.stringify({ success: false, error: "Database error while fetching quote", code: "DB_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!quoteCheck) {
      console.error("[admin-apply-vehicle-quote] Quote not found:", quoteRequestId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Quote request not found. Refresh the page and try again.",
          code: "QUOTE_NOT_FOUND"
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch the order item to get base price
    const { data: orderItem, error: itemError } = await supabase
      .from("order_items")
      .select("id, order_id, base_price_usd, unit_price_usd, quantity, title, is_vehicle")
      .eq("id", quoteCheck.order_item_id)
      .maybeSingle();

    if (itemError || !orderItem) {
      console.error("[admin-apply-vehicle-quote] Order item not found:", quoteCheck.order_item_id, itemError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "The cart item for this quote no longer exists",
          code: "ORDER_ITEM_NOT_FOUND"
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orderItemId = quoteCheck.order_item_id;
    const orderId = orderItem.order_id;
    const vehicleTitle = orderItem.title || quoteCheck.title || "Vehicle";
    const productUrl = quoteCheck.product_url || '';

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found for this quote", code: "ORDER_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // NOTE: Duplicate deletion removed - pure updates only
    // Vehicle items must ALWAYS remain in cart; never delete during admin updates
    const normalizedUrl = normalizeProductUrl(productUrl);
    console.log("[admin-apply-vehicle-quote] Processing quote (NO deletions):", { 
      productUrl, 
      normalizedUrl, 
      orderItemId,
      orderId
    });

    // Get settings including vehicle markup
    const { data: settingsData } = await supabase
      .from("settings")
      .select("exchange_rate_usd_to_cdf, markup_percent, category_markups")
      .limit(1)
      .single();

    const categoryMarkups = (settingsData?.category_markups || {}) as Record<string, number>;
    const generalMarkup = settingsData?.markup_percent ?? 15;
    const vehicleMarkupRaw = categoryMarkups.vehicles ?? generalMarkup;
    const vehicleMarkupPercent = vehicleMarkupRaw < 1 ? vehicleMarkupRaw * 100 : vehicleMarkupRaw;

    // Use provided base price or get from order item
    const vehicleBasePriceUsd = Math.round((
      basePriceUsd || orderItem.base_price_usd || orderItem.unit_price_usd || 0
    ) * 100) / 100;

    // Calculate margin using VEHICLE MARKUP PERCENT (NOT general markup)
    // CRITICAL: ALWAYS use backend-calculated margin - ignore frontend value to prevent race conditions
    const calculatedMargin = Math.round(vehicleBasePriceUsd * (vehicleMarkupPercent / 100) * 100) / 100;
    const finalMarginUsd = calculatedMargin; // AUTHORITATIVE - never trust frontend margin

    // Subtotal = base price + margin (before shipping)
    const finalSubtotalUsd = Math.round((vehicleBasePriceUsd + finalMarginUsd) * 100) / 100;

    // CRITICAL: Recalculate total from components - never trust frontend total
    const finalTotalUsd = Math.round((vehicleBasePriceUsd + finalMarginUsd + finalShippingUsd) * 100) / 100;

    console.log("[admin-apply-vehicle-quote] AUTHORITATIVE backend calculation (ignoring frontend margin/total):", {
      vehicleBasePriceUsd,
      vehicleMarkupPercent,
      calculatedMargin,
      finalMarginUsd,
      finalSubtotalUsd,
      finalShippingUsd,
      finalTotalUsd,
      frontendMarginIgnored: quotedMarginUsd,
      frontendTotalIgnored: totalValue,
      orderId,
      orderItemId
    });

    // 3. UPDATE quote_requests
    const { error: updateQuoteError } = await supabase
      .from("quote_requests")
      .update({
        quoted_shipping_usd: finalShippingUsd,
        quoted_total_usd: finalTotalUsd,
        admin_notes: adminNotes || null,
        status: "SENT",
        quoted_by: user.id,
        quoted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteRequestId);

    if (updateQuoteError) {
      console.error("[admin-apply-vehicle-quote] Failed to update quote:", updateQuoteError);
      throw updateQuoteError;
    }

    console.log("[admin-apply-vehicle-quote] Quote row updated");

    // 4. UPDATE order_items with FULL price breakdown
    const { error: updateItemError } = await supabase
      .from("order_items")
      .update({
        base_price_usd: vehicleBasePriceUsd,      // Vehicle price
        unit_price_usd: vehicleBasePriceUsd,      // Same for display
        subtotal_usd: finalSubtotalUsd,           // Base + margin
        markup_fee_usd: finalMarginUsd,           // Margin amount (NOT 0!)
        shipping_fee_usd: finalShippingUsd,       // Shipping cost
        total_price_usd: finalTotalUsd,           // Grand total
        requires_manual_quote: false,
        vehicle_quote_applied: true,
        is_vehicle: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderItemId);

    if (updateItemError) {
      console.error("[admin-apply-vehicle-quote] Failed to update order item:", updateItemError);
      throw updateItemError;
    }

    console.log("[admin-apply-vehicle-quote] Order item updated with full breakdown:", {
      base: vehicleBasePriceUsd,
      margin: finalMarginUsd,
      shipping: finalShippingUsd,
      total: finalTotalUsd
    });

    // 5. Recalculate order totals by summing ALL active items
    const { data: allItems, error: itemsError } = await supabase
      .from("order_items")
      .select("base_price_usd, subtotal_usd, markup_fee_usd, shipping_fee_usd, total_price_usd, is_saved_for_later, is_vehicle, vehicle_quote_applied")
      .eq("order_id", orderId)
      .eq("is_saved_for_later", false);

    if (itemsError) {
      console.error("[admin-apply-vehicle-quote] Failed to fetch order items:", itemsError);
      throw itemsError;
    }

    // Sum all items
    let orderItemsTotalUsd = 0;    // Sum of base prices (for display as "Total des articles")
    let orderMarkupTotalUsd = 0;   // Sum of margins
    let orderShippingTotalUsd = 0; // Sum of shipping
    let orderGrandTotalUsd = 0;    // Sum of total_price_usd

    for (const item of allItems || []) {
      const itemBase = Number(item.base_price_usd || item.subtotal_usd || 0);
      const itemMarkup = Number(item.markup_fee_usd || 0);
      const itemShipping = Number(item.shipping_fee_usd || 0);
      const itemTotal = Number(item.total_price_usd || 0);

      // For vehicles with quotes, use stored total; otherwise calculate
      if (item.is_vehicle && item.vehicle_quote_applied && itemTotal > 0) {
        orderItemsTotalUsd += itemBase;
        orderMarkupTotalUsd += itemMarkup;
        orderShippingTotalUsd += itemShipping;
        orderGrandTotalUsd += itemTotal;
      } else if (!item.is_vehicle && itemTotal > 0) {
        // Regular item
        orderItemsTotalUsd += itemBase;
        orderMarkupTotalUsd += itemMarkup;
        orderShippingTotalUsd += itemShipping;
        orderGrandTotalUsd += itemTotal;
      }
    }

    // Round totals
    orderItemsTotalUsd = Math.round(orderItemsTotalUsd * 100) / 100;
    orderMarkupTotalUsd = Math.round(orderMarkupTotalUsd * 100) / 100;
    orderShippingTotalUsd = Math.round(orderShippingTotalUsd * 100) / 100;
    orderGrandTotalUsd = Math.round(orderGrandTotalUsd * 100) / 100;

    // Get exchange rate for CDF conversion
    const { data: settings } = await supabase
      .from("settings")
      .select("exchange_rate_usd_to_cdf")
      .limit(1)
      .single();

    const exchangeRate = settings?.exchange_rate_usd_to_cdf || 2500;
    const orderGrandTotalCdf = Math.round(orderGrandTotalUsd * exchangeRate * 100) / 100;

    // Check if any items still require manual quotes
    const stillRequiresQuote = (allItems || []).some(item => 
      item.is_vehicle && !item.vehicle_quote_applied
    );

    console.log("[admin-apply-vehicle-quote] Recalculated order totals:", { 
      orderId, 
      orderItemsTotalUsd,
      orderMarkupTotalUsd,
      orderShippingTotalUsd,
      orderGrandTotalUsd,
      orderGrandTotalCdf,
      stillRequiresQuote
    });

    // 6. Update orders table with recalculated totals
    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({
        item_total_usd: orderItemsTotalUsd,       // Base prices total
        service_fee_usd: orderMarkupTotalUsd,     // Total margin/service fee
        shipping_fee_usd: orderShippingTotalUsd,  // Total shipping
        total_usd: orderGrandTotalUsd,            // Grand total
        total_cdf: orderGrandTotalCdf,
        exchange_rate_used: exchangeRate,
        requires_manual_quote: stillRequiresQuote,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateOrderError) {
      console.error("[admin-apply-vehicle-quote] Failed to update order:", updateOrderError);
      throw updateOrderError;
    }

    console.log("[admin-apply-vehicle-quote] Order totals updated successfully");

    // 7. Send email notification (non-blocking) — ALWAYS log attempt
    let emailSent = false;
    let emailErrorMessage: string | null = null;
    try {
      const emailResponse = await fetch(
        `${supabaseUrl}/functions/v1/send-quote-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            quoteRequestId,
            quotedShippingUsd: finalShippingUsd,
            quotedTotalUsd: finalTotalUsd,
            adminNotes: adminNotes || undefined,
          }),
        }
      );
      const emailResult = await emailResponse.json();
      const emailError = emailResponse.ok ? null : { message: emailResult?.error || `HTTP ${emailResponse.status}` };

      if (!emailError && (emailResult?.success || emailResponse.ok)) {
        emailSent = true;
        console.log("[admin-apply-vehicle-quote] Quote email sent successfully");
      } else {
        emailErrorMessage = emailError?.message || emailResult?.error || "Unknown email error";
        console.error("[admin-apply-vehicle-quote] Email FAILED:", emailErrorMessage, { emailError, emailResult });
      }
    } catch (emailErr: any) {
      emailErrorMessage = emailErr?.message || String(emailErr);
      console.error("[admin-apply-vehicle-quote] Email exception (non-fatal):", emailErrorMessage);
    }

    // 8. ALWAYS log to customer_email_logs (sent or failed)
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("user_id", quoteCheck.user_id)
        .single();

      if (profile?.email) {
        await supabase
          .from("customer_email_logs")
          .insert({
            customer_id: quoteCheck.user_id,
            customer_email: profile.email,
            sent_by: user.id,
            subject: `Vehicle Quote Ready - $${finalTotalUsd.toFixed(2)} USD`,
            body: `Quote for ${vehicleTitle}: Base $${vehicleBasePriceUsd.toFixed(2)}, Shipping $${finalShippingUsd.toFixed(2)}, Margin $${finalMarginUsd.toFixed(2)}, Total $${finalTotalUsd.toFixed(2)} USD`,
            status: emailSent ? "sent" : "failed",
          });
      }
    } catch (logErr) {
      console.warn("[admin-apply-vehicle-quote] Failed to log email (non-fatal):", logErr);
    }

    // 8b. If email failed, update quote_requests with email_status for visibility
    if (!emailSent) {
      try {
        await supabase
          .from("quote_requests")
          .update({ 
            updated_at: new Date().toISOString(),
          })
          .eq("id", quoteRequestId);
      } catch (_) { /* best-effort */ }
    }

    // 9. Return success with all values for verification
    const response = {
      success: true,
      ok: true,
      message: emailSent 
        ? "Quote applied and customer notified" 
        : `Quote applied but email FAILED: ${emailErrorMessage || "unknown error"}`,
      emailSent,
      emailError: emailErrorMessage,
      data: {
        quoteRequestId,
        orderItemId,
        orderId,
        // Item-level values (exactly what admin entered)
        vehicleBasePriceUsd,
        quotedMarginUsd: finalMarginUsd,
        quotedShippingUsd: finalShippingUsd,
        quotedTotalUsd: finalTotalUsd,
        // Order-level totals
        orderItemsTotalUsd,
        orderMarkupTotalUsd,
        orderShippingTotalUsd,
        orderGrandTotalUsd,
        orderGrandTotalCdf,
        exchangeRate,
      },
    };

    console.log("[admin-apply-vehicle-quote] SUCCESS:", response.data);

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[admin-apply-vehicle-quote] FATAL ERROR:", error);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        success: false, 
        code: "QUOTE_APPLY_ERROR",
        error: error.message || "Internal server error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
