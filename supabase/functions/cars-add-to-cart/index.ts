/**
 * Cars Add to Cart Edge Function
 * 
 * POST /cars-add-to-cart
 * Body: { listingId, title, price, imageUrl, listingUrl, vin, providerListingId }
 * 
 * Saves a vehicle listing snapshot to user's cart
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AddToCartRequest {
  listingId: string;
  title: string;
  price: number;
  imageUrl?: string;
  listingUrl: string;
  vin?: string;
  providerListingId: string;
  provider?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: "Backend unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Verify authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Parse request body
    const body: AddToCartRequest = await req.json();
    
    if (!body.listingUrl || !body.title || !body.price) {
      return new Response(JSON.stringify({ 
        error: "Missing required fields: listingUrl, title, price" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Find or create user's DRAFT order
    let { data: draftOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "DRAFT")
      .maybeSingle();
    
    if (!draftOrder) {
      const { data: newOrder, error: orderError } = await supabase
        .from("orders")
        .insert({
          user_id: user.id,
          status: "DRAFT",
          contains_vehicle: true,
        })
        .select("id")
        .single();
      
      if (orderError) {
        console.error("[cars-add-to-cart] Failed to create order:", orderError);
        return new Response(JSON.stringify({ error: "Failed to create cart" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      draftOrder = newOrder;
    } else {
      // Update existing order to mark it contains vehicle
      await supabase
        .from("orders")
        .update({ contains_vehicle: true })
        .eq("id", draftOrder.id);
    }
    
    // Check for duplicate
    const { data: existing } = await supabase
      .from("order_items")
      .select("id")
      .eq("order_id", draftOrder.id)
      .eq("product_url", body.listingUrl)
      .maybeSingle();
    
    if (existing) {
      return new Response(JSON.stringify({
        success: true,
        message: "Vehicle already in cart",
        itemId: existing.id,
        duplicate: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Add to cart
    const { data: newItem, error: insertError } = await supabase
      .from("order_items")
      .insert({
        order_id: draftOrder.id,
        store: "OTHER",
        product_url: body.listingUrl,
        title: body.title,
        base_price_usd: body.price,
        unit_price_usd: body.price,
        quantity: 1,
        product_image_url: body.imageUrl || null,
        is_vehicle: true,
        requires_manual_quote: true,
        notes: JSON.stringify({
          type: "vehicle",
          provider: body.provider || "auto_dev",
          providerListingId: body.providerListingId,
          vin: body.vin || null,
          priceAtAdd: body.price,
          addedAt: new Date().toISOString(),
        }),
      })
      .select("id")
      .single();
    
    if (insertError) {
      console.error("[cars-add-to-cart] Failed to add item:", insertError);
      return new Response(JSON.stringify({ error: "Failed to add to cart" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Increment cart version
    await supabase
      .from("orders")
      .update({ 
        cart_version: draftOrder.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", draftOrder.id);
    
    return new Response(JSON.stringify({
      success: true,
      message: "Vehicle added to cart",
      itemId: newItem.id,
      orderId: draftOrder.id,
      requiresQuote: true,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (err) {
    console.error("[cars-add-to-cart] Error:", err);
    
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
