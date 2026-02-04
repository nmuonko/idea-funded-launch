import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'afrishop_recently_viewed';
const MAX_ITEMS = 20;

export interface RecentlyViewedItem {
  id: string;
  provider: string;
  title: string;
  imageUrl: string;
  priceUsd: number;
  productUrl?: string;
  viewedAt: number;
}

export function useRecentlyViewed() {
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setItems(parsed);
      } catch (e) {
        console.error('Failed to parse recently viewed:', e);
      }
    }
  }, []);

  // Save to localStorage when items change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = useCallback((item: Omit<RecentlyViewedItem, 'viewedAt'>) => {
    setItems((prev) => {
      // Remove if already exists
      const filtered = prev.filter(
        (i) => !(i.id === item.id && i.provider === item.provider)
      );
      
      // Add to front with timestamp
      const newItem: RecentlyViewedItem = {
        ...item,
        viewedAt: Date.now(),
      };
      
      // Keep only MAX_ITEMS
      return [newItem, ...filtered].slice(0, MAX_ITEMS);
    });
  }, []);

  const removeItem = useCallback((id: string, provider: string) => {
    setItems((prev) => 
      prev.filter((i) => !(i.id === id && i.provider === provider))
    );
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    items,
    addItem,
    removeItem,
    clearAll,
  };
}
