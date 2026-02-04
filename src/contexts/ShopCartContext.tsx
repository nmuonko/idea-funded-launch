import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CartItem {
  id: string;
  productId: string;
  provider: string;
  title: string;
  imageUrl: string;
  priceUsd: number;
  quantity: number;
  productUrl?: string;
}

interface ShopCartContextType {
  items: CartItem[];
  itemCount: number;
  totalUsd: number;
  loading: boolean;
  addItem: (item: Omit<CartItem, 'id'>) => Promise<void>;
  updateQuantity: (id: string, quantity: number) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  clearCart: () => Promise<void>;
  syncCart: () => Promise<void>;
  // Saved items (wishlist)
  savedItems: CartItem[];
  addToSaved: (item: Omit<CartItem, 'id' | 'quantity'>) => void;
  removeFromSaved: (id: string) => void;
  isItemSaved: (productId: string, provider: string) => boolean;
  // Exchange rate for multi-currency
  exchangeRate: number;
}

const ShopCartContext = createContext<ShopCartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'afrishop_guest_cart';
const SAVED_STORAGE_KEY = 'afrishop_saved_items';

export function ShopCartProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [savedItems, setSavedItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(2200);

  // Load cart and saved items from localStorage for guests
  useEffect(() => {
    if (!user) {
      const storedCart = localStorage.getItem(CART_STORAGE_KEY);
      if (storedCart) {
        try {
          setItems(JSON.parse(storedCart));
        } catch (e) {
          console.error('Failed to parse stored cart:', e);
        }
      }
    }
    
    // Always load saved items from localStorage (works for guests and logged-in users)
    const storedSaved = localStorage.getItem(SAVED_STORAGE_KEY);
    if (storedSaved) {
      try {
        setSavedItems(JSON.parse(storedSaved));
      } catch (e) {
        console.error('Failed to parse saved items:', e);
      }
    }
  }, [user]);

  // Save guest cart to localStorage
  useEffect(() => {
    if (!user && items.length >= 0) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    }
  }, [items, user]);

  // Save wishlist to localStorage
  useEffect(() => {
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedItems));
  }, [savedItems]);

  // Fetch exchange rate from config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mobile-public-config`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          if (data?.exchangeRate) {
            setExchangeRate(data.exchangeRate);
          }
        }
      } catch (e) {
        console.error('Failed to fetch config:', e);
      }
    };
    fetchConfig();
  }, []);

  // Sync cart when user logs in
  const syncCart = useCallback(async () => {
    if (!user || !session) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mobile-get-cart');
      
      if (error) throw error;
      
      if (data?.items) {
        const mappedItems: CartItem[] = data.items.map((item: any) => ({
          id: item.id,
          productId: item.provider_product_id || item.product_url,
          provider: item.store || 'unknown',
          title: item.title || 'Product',
          imageUrl: item.image_url || '',
          priceUsd: item.base_price_usd || 0,
          quantity: item.quantity || 1,
          productUrl: item.product_url,
        }));
        setItems(mappedItems);
      }
      
      // Clear guest cart after sync
      localStorage.removeItem(CART_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to sync cart:', error);
    } finally {
      setLoading(false);
    }
  }, [user, session]);

  useEffect(() => {
    if (user) {
      syncCart();
    }
  }, [user, syncCart]);

  const addItem = async (item: Omit<CartItem, 'id'>) => {
    const newItem: CartItem = {
      ...item,
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    // Check if item already exists
    const existingIndex = items.findIndex(
      (i) => i.productId === item.productId && i.provider === item.provider
    );

    if (existingIndex >= 0) {
      // Update quantity
      const updated = [...items];
      updated[existingIndex].quantity += item.quantity;
      setItems(updated);
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    // If logged in, sync to backend
    if (user && session) {
      try {
        await supabase.functions.invoke('mobile-add-cart-item', {
          body: {
            provider_product_id: item.productId,
            store: item.provider,
            title: item.title,
            image_url: item.imageUrl,
            base_price_usd: item.priceUsd,
            quantity: item.quantity,
            product_url: item.productUrl,
          },
        });
        // Resync to get server IDs
        await syncCart();
      } catch (error) {
        console.error('Failed to add item to server:', error);
      }
    }
  };

  const updateQuantity = async (id: string, quantity: number) => {
    if (quantity <= 0) {
      return removeItem(id);
    }

    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity } : item))
    );

    if (user && session && !id.startsWith('local_')) {
      try {
        await supabase.functions.invoke('mobile-update-cart-item', {
          body: { cart_item_id: id, quantity },
        });
      } catch (error) {
        console.error('Failed to update quantity:', error);
      }
    }
  };

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));

    if (user && session && !id.startsWith('local_')) {
      try {
        await supabase.functions.invoke('mobile-delete-cart-item', {
          body: { cart_item_id: id },
        });
      } catch (error) {
        console.error('Failed to remove item:', error);
      }
    }
  };

  const clearCart = async () => {
    setItems([]);
    localStorage.removeItem(CART_STORAGE_KEY);
  };

  // Saved items (wishlist) functions
  const addToSaved = (item: Omit<CartItem, 'id' | 'quantity'>) => {
    const exists = savedItems.some(
      (s) => s.productId === item.productId && s.provider === item.provider
    );
    if (!exists) {
      const newSavedItem: CartItem = {
        ...item,
        id: `saved_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        quantity: 1,
      };
      setSavedItems((prev) => [...prev, newSavedItem]);
    }
  };

  const removeFromSaved = (id: string) => {
    setSavedItems((prev) => prev.filter((item) => item.id !== id));
  };

  const isItemSaved = (productId: string, provider: string) => {
    return savedItems.some((s) => s.productId === productId && s.provider === provider);
  };

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalUsd = items.reduce((sum, item) => sum + item.priceUsd * item.quantity, 0);

  return (
    <ShopCartContext.Provider
      value={{
        items,
        itemCount,
        totalUsd,
        loading,
        addItem,
        updateQuantity,
        removeItem,
        clearCart,
        syncCart,
        savedItems,
        addToSaved,
        removeFromSaved,
        isItemSaved,
        exchangeRate,
      }}
    >
      {children}
    </ShopCartContext.Provider>
  );
}

export function useShopCart() {
  const context = useContext(ShopCartContext);
  if (!context) {
    throw new Error('useShopCart must be used within a ShopCartProvider');
  }
  return context;
}
