/**
 * Catalog Collection Endpoint
 * 
 * Returns paginated items from a specific collection.
 * DB-first: No live Rainforest calls.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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
    
    // Paginate
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
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
    const orderedItems = pageItemIds
      .map(id => itemMap.get(id))
      .filter(Boolean)
      .map(mapDbItemToResponse);

    return new Response(
      JSON.stringify({
        status: 'success',
        slug: collection.slug,
        title: collection.title,
        description: collection.description,
        items: orderedItems,
        total,
        page,
        pageSize,
        hasMore: endIdx < total,
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
