import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/components/shop/ProductCard';

const RECENTLY_VIEWED_LS_KEY = 'afrishop_recently_viewed';
const MAX_ITEMS = 20;

interface RecentlyViewedItem {
  product_id: string;
  provider: string;
  title: string;
  image_url: string;
  price_usd: number;
  product_url?: string;
  viewed_at: string;
}

/**
 * Track a product view — logged-in users upsert to DB, guests use localStorage
 */
export async function trackRecentlyViewed(
  product: { id: string; provider: string; title: string; imageUrl: string; priceUsd: number; productUrl?: string },
  userId?: string
): Promise<void> {
  const normalizedProvider = (product.provider || 'amazon').toLowerCase().trim();
  const normalizedId = product.id.trim();
  
  const item: RecentlyViewedItem = {
    product_id: normalizedId,
    provider: normalizedProvider,
    title: product.title,
    image_url: product.imageUrl,
    price_usd: product.priceUsd,
    product_url: product.productUrl,
    viewed_at: new Date().toISOString(),
  };

  // Always update localStorage for instant reads
  updateLocalStorage(item);

  // If logged in, also persist to DB
  if (userId) {
    try {
      const storeId = `${normalizedProvider}:${normalizedId}`;
      await supabase.from('recently_viewed_items').upsert(
        [{
          user_id: userId,
          device_id: 'web',
          store_id: storeId,
          product_url: product.productUrl || '',
          title: product.title,
          image_url: product.imageUrl,
          last_viewed_at: new Date().toISOString(),
          view_count: 1,
        }],
        { onConflict: 'user_id,store_id' }
      );
    } catch (err) {
      console.warn('[RecentlyViewed] DB upsert failed, localStorage still works', err);
    }
  }
}

function updateLocalStorage(item: RecentlyViewedItem): void {
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_LS_KEY);
    let items: RecentlyViewedItem[] = stored ? JSON.parse(stored) : [];
    
    // Remove duplicate
    items = items.filter(i => !(i.product_id === item.product_id && i.provider === item.provider));
    
    // Add to front
    items.unshift(item);
    
    // Trim
    if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);
    
    localStorage.setItem(RECENTLY_VIEWED_LS_KEY, JSON.stringify(items));
  } catch (e) {
    // localStorage might be full
  }
}

/**
 * Get recently viewed products — from DB for logged-in users, localStorage for guests
 */
export async function getRecentlyViewed(userId?: string, limit = 12): Promise<Product[]> {
  // Try DB first for logged-in users
  if (userId) {
    try {
      const { data } = await supabase
        .from('recently_viewed_items')
        .select('store_id, product_url, title, image_url, last_viewed_at')
        .eq('user_id', userId)
        .order('last_viewed_at', { ascending: false })
        .limit(limit);

      if (data && data.length > 0) {
        const seen = new Set<string>();
        return data
          .map(item => {
            const [provider, ...idParts] = (item.store_id || '').split(':');
            return {
              id: idParts.join(':') || item.store_id || '',
              provider: provider || 'amazon',
              title: item.title || 'Product',
              imageUrl: item.image_url || '',
              priceUsd: 0,
              productUrl: item.product_url,
            };
          })
          .filter(p => {
            if (!p.id) return false;
            const key = `${p.provider}:${p.id}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      }
    } catch (err) {
      console.warn('[RecentlyViewed] DB fetch failed, falling back to localStorage', err);
    }
  }

  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_LS_KEY);
    if (!stored) return [];
    const items: RecentlyViewedItem[] = JSON.parse(stored);
    const seen = new Set<string>();
    return items.slice(0, limit)
      .map(item => ({
        id: item.product_id,
        provider: item.provider,
        title: item.title,
        imageUrl: item.image_url,
        priceUsd: item.price_usd,
        productUrl: item.product_url,
      }))
      .filter(p => {
        const key = `${p.provider}:${p.id}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch {
    return [];
  }
}
