import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify admin authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[backfill] Missing authorization header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('[backfill] Auth error:', authError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role
    const { data: isAdmin } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'admin' 
    });

    if (!isAdmin) {
      console.error('[backfill] User is not admin:', user.id);
      return new Response(JSON.stringify({ error: 'Forbidden - Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[backfill] Admin verified:', user.email);

    // Get all order items with null product_image_url
    const { data: items, error: fetchError } = await supabase
      .from('order_items')
      .select('id, product_url, title')
      .is('product_image_url', null)
      .limit(50); // Process in batches to avoid timeout

    if (fetchError) {
      console.error('[backfill] Failed to fetch items:', fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!items || items.length === 0) {
      console.log('[backfill] No items need backfilling');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No items need backfilling',
        processed: 0 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[backfill] Found ${items.length} items to process`);

    const results = {
      processed: 0,
      updated: 0,
      failed: 0,
      details: [] as any[],
    };

    // Process each item
    for (const item of items) {
      results.processed++;
      
      try {
        console.log(`[backfill] Processing item ${item.id}: ${item.product_url}`);
        
        // Call get-product-info to scrape the image
        const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/get-product-info`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ productUrl: item.product_url }),
        });

        if (!scrapeResponse.ok) {
          console.error(`[backfill] Scrape failed for ${item.id}:`, scrapeResponse.status);
          results.failed++;
          results.details.push({ id: item.id, status: 'scrape_failed' });
          continue;
        }

        const scrapeData = await scrapeResponse.json();
        console.log(`[backfill] Scraped data for ${item.id}:`, JSON.stringify(scrapeData));

        if (!scrapeData.imageUrl) {
          console.log(`[backfill] No image found for ${item.id}`);
          results.details.push({ id: item.id, status: 'no_image_found' });
          continue;
        }

        // Update the order_item with the scraped image
        const updateData: any = {
          product_image_url: scrapeData.imageUrl,
        };
        
        // Also update title if it was missing
        if (!item.title && scrapeData.title) {
          updateData.title = scrapeData.title;
        }

        const { error: updateError } = await supabase
          .from('order_items')
          .update(updateData)
          .eq('id', item.id);

        if (updateError) {
          console.error(`[backfill] Update failed for ${item.id}:`, updateError);
          results.failed++;
          results.details.push({ id: item.id, status: 'update_failed', error: updateError.message });
        } else {
          console.log(`[backfill] Updated ${item.id} with image:`, scrapeData.imageUrl);
          results.updated++;
          results.details.push({ 
            id: item.id, 
            status: 'updated', 
            imageUrl: scrapeData.imageUrl,
            title: scrapeData.title 
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (itemError: any) {
        console.error(`[backfill] Error processing ${item.id}:`, itemError.message);
        results.failed++;
        results.details.push({ id: item.id, status: 'error', error: itemError.message });
      }
    }

    console.log('[backfill] Complete:', results);

    return new Response(JSON.stringify({
      success: true,
      ...results,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[backfill] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
