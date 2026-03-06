import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SetImageRequest {
  productUrl: string;
  imageUrl: string;
  title?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  const traceId = `trace-${Math.random().toString(36).slice(2, 10)}`;

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin role
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: SetImageRequest = await req.json();
    const { productUrl, imageUrl, title } = body;

    if (!productUrl || !imageUrl) {
      return new Response(
        JSON.stringify({ error: 'productUrl and imageUrl are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate imageUrl is a valid URL
    try {
      new URL(imageUrl);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid imageUrl format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${traceId}] Admin setting product image:`, { productUrl, imageUrl, title });

    // Determine store from URL
    let store = 'other';
    try {
      const urlObj = new URL(productUrl);
      store = urlObj.hostname.replace(/^(www\.|m\.)/, '');
    } catch {
      // Keep default 'other'
    }

    // 1. Update product_cache
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Admin-set images expire in 30 days

    const cacheUpdate: Record<string, unknown> = {
      product_url: productUrl,
      image_url: imageUrl,
      store,
      source: 'admin_override',
      expires_at: expiresAt.toISOString(),
      last_scrape_status: 'OK',
      last_scrape_at: new Date().toISOString(),
    };

    if (title) {
      cacheUpdate.title = title;
    }

    const { error: cacheError } = await supabase
      .from('product_cache')
      .upsert(cacheUpdate, { onConflict: 'product_url' });

    if (cacheError) {
      console.error(`[${traceId}] Failed to update product_cache:`, cacheError);
    } else {
      console.log(`[${traceId}] Updated product_cache`);
    }

    // 2. Update all order_items with this product URL
    const { data: updatedItems, error: itemsError } = await supabase
      .from('order_items')
      .update({ 
        product_image_url: imageUrl,
        ...(title ? { title } : {})
      })
      .eq('product_url', productUrl)
      .select('id');

    if (itemsError) {
      console.error(`[${traceId}] Failed to update order_items:`, itemsError);
    } else {
      console.log(`[${traceId}] Updated ${updatedItems?.length || 0} order_items`);
    }

    // 3. Update recently_viewed_items with this product URL
    const { data: updatedViewed, error: viewedError } = await supabase
      .from('recently_viewed_items')
      .update({ 
        image_url: imageUrl,
        ...(title ? { title } : {})
      })
      .eq('product_url', productUrl)
      .select('id');

    if (viewedError) {
      console.error(`[${traceId}] Failed to update recently_viewed_items:`, viewedError);
    } else {
      console.log(`[${traceId}] Updated ${updatedViewed?.length || 0} recently_viewed_items`);
    }

    // 4. Remove from retry queue if present
    await supabase
      .from('scrape_retry_queue')
      .delete()
      .eq('product_url', productUrl);

    // Log admin action
    await supabase.from('admin_audit_logs').insert({
      admin_id: user.id,
      admin_email: user.email,
      action_type: 'SET_PRODUCT_IMAGE',
      target_section: 'products',
      details: {
        productUrl,
        imageUrl,
        title,
        orderItemsUpdated: updatedItems?.length || 0,
        recentlyViewedUpdated: updatedViewed?.length || 0,
      },
    });

    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        productUrl,
        imageUrl,
        orderItemsUpdated: updatedItems?.length || 0,
        recentlyViewedUpdated: updatedViewed?.length || 0,
        duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[${traceId}] Error:`, error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
