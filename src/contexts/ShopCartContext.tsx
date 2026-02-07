import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface FeeSettings {
  markupPercent: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
}

export interface CartItem {
  id: string;
  productId: string;
  provider: string;
  title: string;
  imageUrl: string;
  priceUsd: number;
  quantity: number;
  productUrl?: string;
  isVehicle?: boolean;
  requiresManualQuote?: boolean;
  vehicleQuoteApplied?: boolean;
}

export type VehicleQuoteStatus = 'none' | 'pending' | 'quoted';

export interface PendingCheckoutSnapshot {
  items: CartItem[];
  timestamp: number;
  paymentMethod?: string;
  orderId?: string;
  currency?: string;
  totalUsd?: number;
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
  clearCartOnPaymentSuccess: () => Promise<void>;
  syncCart: () => Promise<void>;
  // Pending checkout snapshot
  savePendingCheckout: (snapshot: Partial<PendingCheckoutSnapshot>) => void;
  getPendingCheckout: () => PendingCheckoutSnapshot | null;
  clearPendingCheckout: () => void;
  restoreFromPendingCheckout: () => boolean;
  // Saved items (wishlist)
  savedItems: CartItem[];
  addToSaved: (item: Omit<CartItem, 'id' | 'quantity'>) => void;
  removeFromSaved: (id: string) => void;
  isItemSaved: (productId: string, provider: string) => boolean;
  // Exchange rate for multi-currency
  exchangeRate: number;
  // Fee settings from admin
  feeSettings: FeeSettings;
  // Vehicle quote workflow
  hasVehicleItems: boolean;
  vehicleQuoteStatus: VehicleQuoteStatus;
  canProceedToPayment: boolean;
  serverTotalUsd: number | null;
}

const ShopCartContext = createContext<ShopCartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'afrishop_cart_v1';
const PENDING_CHECKOUT_KEY = 'afrishop_pending_checkout_v1';
const SAVED_STORAGE_KEY = 'afrishop_saved_items';
const PENDING_CHECKOUT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export function ShopCartProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [savedItems, setSavedItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(2200);
  const [initialized, setInitialized] = useState(false);
  const [feeSettings, setFeeSettings] = useState<FeeSettings>({
    markupPercent: 15,
    shippingBaseFeeUsd: 20,
    shippingPercent: 10,
  });
  const [hasVehicleItems, setHasVehicleItems] = useState(false);
  const [vehicleQuoteStatus, setVehicleQuoteStatus] = useState<VehicleQuoteStatus>('none');
  const [canProceedToPayment, setCanProceedToPayment] = useState(true);
  const [serverTotalUsd, setServerTotalUsd] = useState<number | null>(null);

  // Load cart from localStorage on init (for guests) or as fallback
  useEffect(() => {
    const storedCart = localStorage.getItem(CART_STORAGE_KEY);
    if (storedCart) {
      try {
        const parsed = JSON.parse(storedCart);
        console.log('[CART] init source=localStorage items=', parsed.length);
        setItems(parsed);
      } catch (e) {
        console.error('[CART] Failed to parse stored cart:', e);
      }
    }
    setInitialized(true);

    // Always load saved items from localStorage (works for guests and logged-in users)
    const storedSaved = localStorage.getItem(SAVED_STORAGE_KEY);
    if (storedSaved) {
      try {
        setSavedItems(JSON.parse(storedSaved));
      } catch (e) {
        console.error('[CART] Failed to parse saved items:', e);
      }
    }
  }, []);

  // Always persist cart to localStorage as backup
  useEffect(() => {
    if (initialized) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
      console.log('[CART] persisted items=', items.length, 'key=', CART_STORAGE_KEY);
    }
  }, [items, initialized]);

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
          // Extract fee settings from API response
          if (data) {
            setFeeSettings({
              // API returns nested structure: markup.value, shipping.flatUsd, shipping.percentValue
              markupPercent: data.markup?.value ?? data.markupPercent ?? 15,
              shippingBaseFeeUsd: data.shipping?.flatUsd ?? data.shippingBaseFeeUsd ?? 20,
              shippingPercent: data.shipping?.percentValue ?? data.shippingPercent ?? 10,
            });
            console.log('[CART] Fee settings loaded:', {
              markupPercent: data.markup?.value,
              shippingBaseFeeUsd: data.shipping?.flatUsd,
              shippingPercent: data.shipping?.percentValue,
            });
          }
        }
      } catch (e) {
        console.error('[CART] Failed to fetch config:', e);
      }
    };
    fetchConfig();
  }, []);

  // Pending checkout snapshot functions
  const savePendingCheckout = useCallback((snapshot: Partial<PendingCheckoutSnapshot>) => {
    const fullSnapshot: PendingCheckoutSnapshot = {
      items: snapshot.items || items,
      timestamp: Date.now(),
      paymentMethod: snapshot.paymentMethod,
      orderId: snapshot.orderId,
      currency: snapshot.currency || 'USD',
      totalUsd: snapshot.totalUsd || items.reduce((sum, item) => sum + item.priceUsd * item.quantity, 0),
    };
    localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(fullSnapshot));
    console.log('[CHECKOUT] pending snapshot saved orderId=', fullSnapshot.orderId, 'items=', fullSnapshot.items.length);
  }, [items]);

  const getPendingCheckout = useCallback((): PendingCheckoutSnapshot | null => {
    const stored = localStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!stored) return null;
    try {
      const snapshot = JSON.parse(stored) as PendingCheckoutSnapshot;
      // Check if expired
      if (Date.now() - snapshot.timestamp > PENDING_CHECKOUT_EXPIRY_MS) {
        console.log('[CART] pending checkout snapshot expired');
        localStorage.removeItem(PENDING_CHECKOUT_KEY);
        return null;
      }
      return snapshot;
    } catch (e) {
      console.error('[CART] Failed to parse pending checkout:', e);
      return null;
    }
  }, []);

  const clearPendingCheckout = useCallback(() => {
    localStorage.removeItem(PENDING_CHECKOUT_KEY);
    console.log('[CART] pending checkout cleared');
  }, []);

  const restoreFromPendingCheckout = useCallback((): boolean => {
    const snapshot = getPendingCheckout();
    if (snapshot && snapshot.items.length > 0) {
      console.log('[CART] restored from pending snapshot items=', snapshot.items.length);
      setItems(snapshot.items);
      return true;
    }
    return false;
  }, [getPendingCheckout]);

  // Sync cart when user logs in
  const syncCart = useCallback(async () => {
    if (!user || !session) return;
    
    setLoading(true);
    try {
      console.log('[CART] syncing with server for user=', user.id);
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
          isVehicle: item.is_vehicle || false,
          requiresManualQuote: item.requires_manual_quote || false,
          vehicleQuoteApplied: item.vehicle_quote_applied || false,
        }));
        setItems(mappedItems);
        console.log('[CART] init source=server items=', mappedItems.length);
        
        // Update vehicle flags from summary
        const summary = data.summary || data;
        setHasVehicleItems(!!summary.hasVehicleItems);
        setVehicleQuoteStatus(summary.vehicleQuoteStatus || 'none');
        setCanProceedToPayment(summary.canProceedToPayment !== false);
        if (summary.serverTotalUsd != null || summary.total_usd != null) {
          setServerTotalUsd(summary.serverTotalUsd ?? summary.total_usd);
        }
        console.log('[CART] vehicle flags:', { hasVehicle: summary.hasVehicleItems, quoteStatus: summary.vehicleQuoteStatus, canProceed: summary.canProceedToPayment });
      }
    } catch (error) {
      console.error('[CART] Failed to sync cart:', error);
    } finally {
      setLoading(false);
    }
  }, [user, session]);

  useEffect(() => {
    if (user && initialized) {
      // Merge guest cart to server if needed
      const guestCart = localStorage.getItem(CART_STORAGE_KEY);
      if (guestCart) {
        try {
          const guestItems = JSON.parse(guestCart) as CartItem[];
          if (guestItems.length > 0) {
            console.log('[CART] merge guest->server items=', guestItems.length);
            // The sync will handle merging
          }
        } catch (e) {
          // Ignore
        }
      }
      syncCart();
    }
  }, [user, initialized, syncCart]);

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
        // Build productUrl if not provided - construct from provider and productId
        let productUrl = item.productUrl;
        if (!productUrl && item.productId) {
          // Extract clean product ID (remove provider prefix if present)
          let cleanId = item.productId;
          const lowerCleanId = cleanId.toLowerCase();
          
          if (lowerCleanId.startsWith('amazon_')) {
            cleanId = cleanId.slice(7);
          } else if (lowerCleanId.startsWith('rainforest_')) {
            cleanId = cleanId.slice(11);
          } else if (lowerCleanId.startsWith('ebay_')) {
            cleanId = cleanId.slice(5);
          }
          
          // Build URL using allowed domain based on provider
          if (item.provider === 'ebay') {
            productUrl = `https://www.ebay.com/itm/${cleanId}`;
          } else {
            // Default to Amazon for rainforest/amazon/other providers
            productUrl = `https://www.amazon.com/dp/${cleanId}`;
          }
        }

        if (!productUrl) {
          console.error('[CART] Cannot sync item without productUrl:', item);
          return;
        }

        await supabase.functions.invoke('mobile-add-cart-item', {
          body: {
            productUrl,
            productPrice: item.priceUsd,
            quantity: item.quantity,
            productTitle: item.title,
            productImageUrl: item.imageUrl,
          },
        });
        // Resync to get server IDs
        await syncCart();
      } catch (error) {
        console.error('[CART] Failed to add item to server:', error);
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
        console.error('[CART] Failed to update quantity:', error);
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
        console.error('[CART] Failed to remove item:', error);
      }
    }
  };

  // clearCart - for general cart clearing (NOT on checkout prepare)
  const clearCart = async () => {
    console.log('[CART] clearCart called - setting items to empty');
    setItems([]);
  };

  // clearCartOnPaymentSuccess - only call this after confirmed payment
  const clearCartOnPaymentSuccess = async () => {
    console.log('[PAYMENT] success orderId=... -> clear cart');
    setItems([]);
    localStorage.removeItem(CART_STORAGE_KEY);
    clearPendingCheckout();
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
        clearCartOnPaymentSuccess,
        syncCart,
        savePendingCheckout,
        getPendingCheckout,
        clearPendingCheckout,
        restoreFromPendingCheckout,
        savedItems,
        addToSaved,
        removeFromSaved,
        isItemSaved,
        exchangeRate,
        feeSettings,
        hasVehicleItems,
        vehicleQuoteStatus,
        canProceedToPayment,
        serverTotalUsd,
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
