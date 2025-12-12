import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Admin Apply Vehicle Quote
 * 
 * Called by admin panel when setting a quote for a vehicle.
 * Updates quote_requests, order_items, and recalculates order totals.
 * Triggers email notification to customer.
 * 
 * POST /admin-apply-vehicle-quote
 * Body: {
 *   quoteRequestId: string,
 *   quotedShippingUsd: number,
 *   quotedTotalUsd: number,
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

    const shippingValue = parseFloat(quotedShippingUsd);
    const totalValue = parseFloat(quotedTotalUsd);

    if (isNaN(shippingValue) || isNaN(totalValue) || shippingValue < 0 || totalValue < 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid shipping or total values" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[admin-apply-vehicle-quote] Applying quote:", { quoteRequestId, shippingValue, totalValue });

    // Fetch the quote request with order item details
    const { data: quoteRequest, error: quoteError } = await supabase
      .from("quote_requests")
      .select("*, order_items!inner(id, order_id, base_price_usd, quantity)")
      .eq("id", quoteRequestId)
      .single();

    if (quoteError || !quoteRequest) {
      console.error("[admin-apply-vehicle-quote] Quote not found:", quoteError);
      return new Response(
        JSON.stringify({ success: false, error: "Quote request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orderItemId = quoteRequest.order_item_id;
    const orderId = quoteRequest.order_items?.order_id;

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found for quote request" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. UPSERT quote_requests row - ensures no duplicates, replaces existing
    // Uses the unique constraint on order_item_id for upsert
    const { error: updateQuoteError } = await supabase
      .from("quote_requests")
      .upsert({
        id: quoteRequestId,
        order_item_id: orderItemId,
        user_id: quoteRequest.user_id,
        title: quoteRequest.title,
        product_url: quoteRequest.product_url,
        store_name: quoteRequest.store_name,
        quoted_shipping_usd: shippingValue,
        quoted_total_usd: totalValue,
        admin_notes: adminNotes || null,
        status: "SENT",
        locale: quoteRequest.locale || 'fr',
        customer_email: quoteRequest.customer_email,
        updated_at: new Date().toISOString(),
      }, { 
        onConflict: 'order_item_id',
        ignoreDuplicates: false 
      });

    if (updateQuoteError) {
      console.error("[admin-apply-vehicle-quote] Failed to upsert quote:", updateQuoteError);
      throw updateQuoteError;
    }

    console.log("[admin-apply-vehicle-quote] Quote upserted with shipping:", shippingValue, "total:", totalValue);

    // 2. Update order_items row - CRITICAL: Set shipping/total to EXACTLY admin values
    // These values MUST match what admin entered - no recalculation
    const { error: updateItemError } = await supabase
      .from("order_items")
      .update({
        shipping_fee_usd: shippingValue,          // EXACT admin value
        total_price_usd: totalValue,              // EXACT admin value
        requires_manual_quote: false,             // Clear the quote requirement
        vehicle_quote_applied: true,              // Mark that quote has been applied
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderItemId);

    if (updateItemError) {
      console.error("[admin-apply-vehicle-quote] Failed to update order item:", updateItemError);
      throw updateItemError;
    }

    console.log("[admin-apply-vehicle-quote] Order item updated with EXACT admin values");

    // 3. Recalculate order totals by summing all items
    const { data: allItems, error: itemsError } = await supabase
      .from("order_items")
      .select("total_price_usd, shipping_fee_usd, is_saved_for_later")
      .eq("order_id", orderId)
      .eq("is_saved_for_later", false);

    if (itemsError) {
      console.error("[admin-apply-vehicle-quote] Failed to fetch order items:", itemsError);
      throw itemsError;
    }

    // Calculate new order totals
    let newTotalUsd = 0;
    let newShippingUsd = 0;
    for (const item of allItems || []) {
      newTotalUsd += Number(item.total_price_usd || 0);
      newShippingUsd += Number(item.shipping_fee_usd || 0);
    }

    // Get exchange rate for CDF conversion
    const { data: settings } = await supabase
      .from("settings")
      .select("exchange_rate_usd_to_cdf")
      .limit(1)
      .single();

    const exchangeRate = settings?.exchange_rate_usd_to_cdf || 2800;
    const newTotalCdf = Math.round(newTotalUsd * exchangeRate * 100) / 100;

    // 4. Update orders table with recalculated totals
    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({
        shipping_fee_usd: newShippingUsd,
        total_usd: newTotalUsd,
        total_cdf: newTotalCdf,
        requires_manual_quote: false,  // Clear order-level quote requirement
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateOrderError) {
      console.error("[admin-apply-vehicle-quote] Failed to update order:", updateOrderError);
      throw updateOrderError;
    }

    console.log("[admin-apply-vehicle-quote] Order totals updated:", { orderId, newTotalUsd, newShippingUsd });

    // 5. Trigger email notification to customer (non-blocking)
    let emailSent = false;
    let emailId: string | null = null;
    
    try {
      const { data: emailResult, error: emailError } = await supabase.functions.invoke("send-quote-email", {
        body: {
          quoteRequestId,
          quotedShippingUsd: shippingValue,
          quotedTotalUsd: totalValue,
          adminNotes: adminNotes || undefined,
        },
      });

      if (emailError) {
        console.error("[admin-apply-vehicle-quote] Failed to send quote email:", emailError);
        // Don't fail the whole operation if email fails
      } else {
        emailSent = emailResult?.success || false;
        emailId = emailResult?.emailId || null;
        console.log("[admin-apply-vehicle-quote] Quote email sent successfully, ID:", emailId);
      }
    } catch (emailErr) {
      console.error("[admin-apply-vehicle-quote] Email notification error:", emailErr);
    }

    // 6. Log email to customer_email_logs for tracking
    if (emailSent) {
      try {
        // Get customer email from profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", quoteRequest.user_id)
          .single();

        if (profile?.email) {
          const vehicleTitle = quoteRequest.order_items?.title || quoteRequest.title || "Vehicle";
          await supabase
            .from("customer_email_logs")
            .insert({
              customer_id: quoteRequest.user_id,
              customer_email: profile.email,
              sent_by: user.id,
              subject: `Vehicle Quote Ready - $${totalValue.toFixed(2)} USD`,
              body: `Quote for ${vehicleTitle}: Shipping $${shippingValue.toFixed(2)}, Total $${totalValue.toFixed(2)} USD`,
              status: "sent",
            });
          console.log("[admin-apply-vehicle-quote] Email logged to customer_email_logs");
        }
      } catch (logErr) {
        console.warn("[admin-apply-vehicle-quote] Failed to log email:", logErr);
        // Non-blocking - don't fail the operation
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: emailSent 
          ? "Quote applied successfully and customer notified" 
          : "Quote applied successfully (email notification failed)",
        emailSent,
        data: {
          quoteRequestId,
          orderItemId,
          orderId,
          quotedShippingUsd: shippingValue,
          quotedTotalUsd: totalValue,
          orderTotalUsd: newTotalUsd,
          orderTotalCdf: newTotalCdf,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[admin-apply-vehicle-quote] Error:", error);
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
