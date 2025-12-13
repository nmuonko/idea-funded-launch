import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Admin Apply Vehicle Quote - ATOMIC & IDEMPOTENT
 * 
 * Stores vehicle shipping as ABSOLUTE USD value - NO FX conversion, NO margin calculation.
 * Updates quote_requests, order_items, and recalculates order totals atomically.
 * Triggers email notification to customer.
 * 
 * POST /admin-apply-vehicle-quote
 * Body: {
 *   quoteRequestId: string,
 *   quotedShippingUsd: number,   // ABSOLUTE USD - stored exactly as entered
 *   quotedTotalUsd: number,      // ABSOLUTE USD - vehicle price + shipping
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
    const { quoteRequestId, quotedShippingUsd, quotedTotalUsd, adminNotes } = body;

    if (!quoteRequestId || quotedShippingUsd === undefined || quotedTotalUsd === undefined) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: quoteRequestId, quotedShippingUsd, quotedTotalUsd" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CRITICAL: Parse as numbers and validate - NO string conversions
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

    // Round to 2 decimal places - this is the FINAL stored value
    const finalShippingUsd = Math.round(shippingValue * 100) / 100;
    const finalTotalUsd = Math.round(totalValue * 100) / 100;

    console.log("[admin-apply-vehicle-quote] APPLYING QUOTE:", { 
      quoteRequestId, 
      inputShipping: quotedShippingUsd,
      inputTotal: quotedTotalUsd,
      finalShippingUsd, 
      finalTotalUsd,
      adminId: user.id
    });

    // 1. Fetch the quote request (without join for reliability)
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

    // 2. Fetch the order item separately
    const { data: orderItem, error: itemError } = await supabase
      .from("order_items")
      .select("id, order_id, base_price_usd, quantity, title, is_vehicle")
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

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found for this quote", code: "ORDER_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate vehicle price from total - shipping
    const vehiclePriceUsd = Math.round((finalTotalUsd - finalShippingUsd) * 100) / 100;

    console.log("[admin-apply-vehicle-quote] Calculated values:", {
      vehiclePriceUsd,
      finalShippingUsd,
      finalTotalUsd,
      orderId,
      orderItemId
    });

    // 3. UPDATE quote_requests - IDEMPOTENT update, not upsert
    const { error: updateQuoteError } = await supabase
      .from("quote_requests")
      .update({
        quoted_shipping_usd: finalShippingUsd,  // EXACT value
        quoted_total_usd: finalTotalUsd,        // EXACT value
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

    console.log("[admin-apply-vehicle-quote] Quote row updated - shipping:", finalShippingUsd, "total:", finalTotalUsd);

    // 4. UPDATE order_items - CRITICAL: Store ABSOLUTE values with NO recalculation
    // These are the FINAL values - mobile-get-cart must use them as-is for vehicles
    const { error: updateItemError } = await supabase
      .from("order_items")
      .update({
        base_price_usd: vehiclePriceUsd,         // Vehicle price (total - shipping)
        subtotal_usd: vehiclePriceUsd,           // Same as base for vehicles (no markup)
        markup_fee_usd: 0,                       // NO markup on vehicles - included in quoted total
        shipping_fee_usd: finalShippingUsd,      // EXACT admin value - NEVER recalculate
        total_price_usd: finalTotalUsd,          // EXACT admin value - NEVER recalculate
        requires_manual_quote: false,            // Quote has been provided
        vehicle_quote_applied: true,             // Flag: use stored values, don't recalculate
        is_vehicle: true,                        // Ensure marked as vehicle
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderItemId);

    if (updateItemError) {
      console.error("[admin-apply-vehicle-quote] Failed to update order item:", updateItemError);
      throw updateItemError;
    }

    console.log("[admin-apply-vehicle-quote] Order item updated with EXACT admin values - NO recalculation will occur");

    // 5. Recalculate order totals by summing ALL active items
    const { data: allItems, error: itemsError } = await supabase
      .from("order_items")
      .select("total_price_usd, shipping_fee_usd, is_saved_for_later, is_vehicle, vehicle_quote_applied")
      .eq("order_id", orderId)
      .eq("is_saved_for_later", false);

    if (itemsError) {
      console.error("[admin-apply-vehicle-quote] Failed to fetch order items:", itemsError);
      throw itemsError;
    }

    // Sum all items - for vehicles with quotes, use stored values
    let newItemsTotalUsd = 0;
    let newShippingTotalUsd = 0;
    for (const item of allItems || []) {
      newItemsTotalUsd += Number(item.total_price_usd || 0);
      newShippingTotalUsd += Number(item.shipping_fee_usd || 0);
    }

    // Round totals
    newItemsTotalUsd = Math.round(newItemsTotalUsd * 100) / 100;
    newShippingTotalUsd = Math.round(newShippingTotalUsd * 100) / 100;

    // Get exchange rate for CDF conversion
    const { data: settings } = await supabase
      .from("settings")
      .select("exchange_rate_usd_to_cdf")
      .limit(1)
      .single();

    const exchangeRate = settings?.exchange_rate_usd_to_cdf || 2800;
    const newTotalCdf = Math.round(newItemsTotalUsd * exchangeRate * 100) / 100;

    // Check if any items still require manual quotes
    const stillRequiresQuote = (allItems || []).some(item => 
      item.is_vehicle && !item.vehicle_quote_applied
    );

    console.log("[admin-apply-vehicle-quote] Recalculated order totals:", { 
      orderId, 
      newItemsTotalUsd, 
      newShippingTotalUsd,
      newTotalCdf,
      stillRequiresQuote
    });

    // 6. Update orders table
    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({
        item_total_usd: newItemsTotalUsd,
        shipping_fee_usd: newShippingTotalUsd,
        total_usd: newItemsTotalUsd,  // total_usd = sum of all item totals (shipping included in item.total_price_usd)
        total_cdf: newTotalCdf,
        requires_manual_quote: stillRequiresQuote,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateOrderError) {
      console.error("[admin-apply-vehicle-quote] Failed to update order:", updateOrderError);
      throw updateOrderError;
    }

    console.log("[admin-apply-vehicle-quote] Order totals updated successfully");

    // 7. Send email notification (non-blocking)
    let emailSent = false;
    try {
      const { data: emailResult, error: emailError } = await supabase.functions.invoke("send-quote-email", {
        body: {
          quoteRequestId,
          quotedShippingUsd: finalShippingUsd,
          quotedTotalUsd: finalTotalUsd,
          adminNotes: adminNotes || undefined,
        },
      });

      if (!emailError && emailResult?.success) {
        emailSent = true;
        console.log("[admin-apply-vehicle-quote] Quote email sent successfully");
      } else {
        console.warn("[admin-apply-vehicle-quote] Email not sent:", emailError);
      }
    } catch (emailErr) {
      console.error("[admin-apply-vehicle-quote] Email error (non-fatal):", emailErr);
    }

    // 8. Log to customer_email_logs
    if (emailSent) {
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
              body: `Quote for ${vehicleTitle}: Shipping $${finalShippingUsd.toFixed(2)}, Total $${finalTotalUsd.toFixed(2)} USD`,
              status: "sent",
            });
        }
      } catch (logErr) {
        console.warn("[admin-apply-vehicle-quote] Failed to log email (non-fatal):", logErr);
      }
    }

    // 9. Return success with all values for verification
    const response = {
      success: true,
      ok: true,
      message: emailSent 
        ? "Quote applied and customer notified" 
        : "Quote applied (email notification skipped)",
      emailSent,
      data: {
        quoteRequestId,
        orderItemId,
        orderId,
        // Echo back EXACT values that were stored
        quotedShippingUsd: finalShippingUsd,
        quotedTotalUsd: finalTotalUsd,
        vehiclePriceUsd,
        // Order-level totals
        orderItemsTotalUsd: newItemsTotalUsd,
        orderShippingTotalUsd: newShippingTotalUsd,
        orderTotalCdf: newTotalCdf,
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