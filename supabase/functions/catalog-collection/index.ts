/**
 * Catalog Collection Endpoint
 * 
 * Returns paginated items from a specific collection.
 * DB-first: No live Rainforest calls.
 * 
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isDisallowedItem } from '../_shared/contentBlocker.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CatalogItem {
  id: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  brand: string | null;
  category: string | null;
}

function mapDbItemToResponse(item: any): CatalogItem {
  return {
    id: item.id,
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: item.image_url,
    images: item.images || [],
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    reviewCount: item.review_count,
    brand: item.brand,
    category: item.category,
  };
}

/**
 * Filter items through content blocker
 */
function filterBlockedItems(items: CatalogItem[]): { filtered: CatalogItem[]; removedCount: number } {
  let removedCount = 0;
  const filtered = items.filter(item => {
    const result = isDisallowedItem({
      title: item.title,
      productUrl: item.productUrl,
      category: item.category,
    });
    if (result.isDisallowed) {
      removedCount++;
      return false;
    }
    return true;
  });
  
  if (removedCount > 0) {
    console.log(`[COLLECTION_FILTER] removed=${removedCount} remaining=${filtered.length}`);
  }
  
  return { filtered, removedCount };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') || 'trending_electronics';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(40, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10)));

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get collection
    const { data: collection, error: collectionError } = await supabase
      .from('catalog_collections')
      .select('slug, title, description, item_ids, updated_at')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (collectionError) {
      console.error('[COLLECTION] Error fetching collection:', collectionError);
      return new Response(
        JSON.stringify({ status: 'error', error: collectionError.message, items: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!collection) {
      return new Response(
        JSON.stringify({ 
          status: 'success', 
          slug,
          title: slug,
          items: [],
          total: 0,
          page,
          pageSize,
          hasMore: false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const allItemIds: string[] = collection.item_ids || [];
    const total = allItemIds.length;
    
    // Fetch extra items to account for filtering
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize + 10; // Extra buffer for filtering
    const pageItemIds = allItemIds.slice(startIdx, endIdx);

    if (pageItemIds.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'success',
          slug: collection.slug,
          title: collection.title,
          description: collection.description,
          items: [],
          total,
          page,
          pageSize,
          hasMore: false,
          updatedAt: collection.updated_at,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch items
    const { data: items, error: itemsError } = await supabase
      .from('catalog_items')
      .select('*')
      .in('id', pageItemIds);

    if (itemsError) {
      console.error('[COLLECTION] Error fetching items:', itemsError);
      return new Response(
        JSON.stringify({ status: 'error', error: itemsError.message, items: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Preserve order from item_ids
    const itemMap = new Map((items || []).map(i => [i.id, i]));
    const rawItems = pageItemIds
      .map(id => itemMap.get(id))
      .filter(Boolean)
      .map(mapDbItemToResponse);

    // HARD BLOCK: Filter out books/subscriptions/streaming
    const { filtered: orderedItems, removedCount } = filterBlockedItems(rawItems);
    
    // Trim to pageSize after filtering
    const finalItems = orderedItems.slice(0, pageSize);

    return new Response(
      JSON.stringify({
        status: 'success',
        slug: collection.slug,
        title: collection.title,
        description: collection.description,
        items: finalItems,
        total,
        page,
        pageSize,
        hasMore: (startIdx + pageSize) < total,
        removedDisallowedCount: removedCount,
        updatedAt: collection.updated_at,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[COLLECTION] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        items: [],
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
