import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface FeeSettings {
  markupPercent: number;
  vehicleMarkupPercent: number;
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
  initialized: boolean;
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
  markQuoteRequested: () => void;
  // Item selection for checkout
  selectedItemIds: Set<string>;
  toggleItemSelection: (id: string) => void;
  selectAllItems: () => void;
  deselectAllItems: () => void;
  selectedItems: CartItem[];
  selectedTotalUsd: number;
  selectedHasVehicleItems: boolean;
  selectedCanProceedToPayment: boolean;
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
    vehicleMarkupPercent: 15,
    shippingBaseFeeUsd: 20,
    shippingPercent: 10,
  });
  const [hasVehicleItems, setHasVehicleItems] = useState(false);
  const [vehicleQuoteStatus, setVehicleQuoteStatus] = useState<VehicleQuoteStatus>('none');
  const [canProceedToPayment, setCanProceedToPayment] = useState(true);
  const [serverTotalUsd, setServerTotalUsd] = useState<number | null>(null);

  // --- Race condition fix: track items being deleted with TTL ---
  const deletedItemIdsRef = useRef<Map<string, number>>(new Map());

  // --- Sync lock: prevent overlapping syncCart() calls ---
  const syncInProgressRef = useRef(false);
  const pendingSyncRef = useRef(false);

  // --- Item selection state ---
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Keep selectedItemIds in sync with items (auto-select new items, remove stale selections)
  useEffect(() => {
    setSelectedItemIds(prev => {
      const currentIds = new Set(items.map(i => i.id));
      const next = new Set<string>();
      // Keep existing selections that still exist
      for (const id of prev) {
        if (currentIds.has(id)) next.add(id);
      }
      // Auto-select any new items not previously known
      for (const id of currentIds) {
        if (!prev.has(id) && !deletedItemIdsRef.current.has(id)) {
          // If prev was empty (first load), select all; otherwise select new items
          next.add(id);
        }
      }
      return next;
    });
  }, [items]);

  const toggleItemSelection = useCallback((id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllItems = useCallback(() => {
    setSelectedItemIds(new Set(items.map(i => i.id)));
  }, [items]);

  const deselectAllItems = useCallback(() => {
    setSelectedItemIds(new Set());
  }, []);

  const selectedItems = useMemo(() => {
    return items.filter(i => selectedItemIds.has(i.id));
  }, [items, selectedItemIds]);

  const selectedTotalUsd = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + item.priceUsd * item.quantity, 0);
  }, [selectedItems]);

  const selectedHasVehicleItems = useMemo(() => {
    return selectedItems.some(i => i.isVehicle);
  }, [selectedItems]);

  const selectedCanProceedToPayment = useMemo(() => {
    // Can proceed if no selected vehicle items need a quote
    if (!selectedHasVehicleItems) return true;
    return vehicleQuoteStatus === 'quoted';
  }, [selectedHasVehicleItems, vehicleQuoteStatus]);

  // Load cart from localStorage on init — ONLY for guests
  useEffect(() => {
    if (user) {
      // Logged-in users get their cart from server via syncCart
      // Set loading=true immediately so Checkout sees cartLoading=true until sync finishes
      setLoading(true);
      console.log('[CART] init: logged-in user, skipping localStorage load, loading=true until sync');
    } else {
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
  }, [user]);

  // Persist cart to localStorage ONLY for guest users as backup
  useEffect(() => {
    if (initialized && !user) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
      console.log('[CART] persisted items=', items.length, 'key=', CART_STORAGE_KEY);
    }
  }, [items, initialized, user]);

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
          if (data) {
            setFeeSettings({
              markupPercent: data.markup?.value ?? data.markupPercent ?? 15,
              vehicleMarkupPercent: data.markup?.vehicleValue ?? data.markup?.value ?? 15,
              shippingBaseFeeUsd: data.shipping?.flatUsd ?? data.shippingBaseFeeUsd ?? 20,
              shippingPercent: data.shipping?.percentValue ?? data.shippingPercent ?? 10,
            });
            console.log('[CART] Fee settings loaded:', {
              markupPercent: data.markup?.value,
              vehicleMarkupPercent: data.markup?.vehicleValue,
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

  // --- Helpers for optimistic local item preservation ---
  const isLocalId = (id?: string) => typeof id === 'string' && id.startsWith('local_');

  const cartKey = (item: CartItem) =>
    [item.provider || 'unknown', item.productId || 'unknown'].join('|');

  // Sync cart when user logs in — filters out deleted items, preserves optimistic local items
  const syncCart = useCallback(async () => {
    if (!user || !session) return;

    // Lock: avoid overlapping syncs
    if (syncInProgressRef.current) {
      pendingSyncRef.current = true;
      return;
    }
    syncInProgressRef.current = true;
    
    setLoading(true);
    try {
      console.log('[CART] syncing with server for user=', user.id);
      const { data, error } = await supabase.functions.invoke('mobile-get-cart');
      
      if (error) throw error;
      
      if (data?.activeItems) {
        const mappedItems: CartItem[] = data.activeItems.map((item: any) => ({
          id: item.id,
          productId: item.productUrl || item.product_url,
          provider: item.store || 'unknown',
          title: item.title || item.productTitle || 'Product',
          imageUrl: item.image_url || item.mainImageUrl || '',
          priceUsd: item.basePriceUsd || item.base_price_usd || 0,
          quantity: item.quantity || 1,
          productUrl: item.productUrl || item.product_url,
          isVehicle: item.isVehicle || false,
          requiresManualQuote: item.requiresManualQuote || false,
          vehicleQuoteApplied: item.vehicleQuoteApplied || false,
        }));

        // CRITICAL: Filter out items that are currently being deleted locally (with TTL cleanup)
        const now = Date.now();
        const DELETED_TTL_MS = 30_000; // 30 seconds
        // Clean up expired entries
        for (const [delId, ts] of deletedItemIdsRef.current) {
          if (now - ts > DELETED_TTL_MS) deletedItemIdsRef.current.delete(delId);
        }
        const serverFiltered = mappedItems.filter(item => !deletedItemIdsRef.current.has(item.id));

        // CRITICAL: Preserve optimistic local_ items not yet confirmed by server
        const serverKeys = new Set(serverFiltered.map(cartKey));

        setItems(current => {
          const localOptimistic = (current ?? [])
            .filter(it => isLocalId(it.id))
            .filter(it => !serverKeys.has(cartKey(it)));

          console.log('[CART] sync merge: server=', serverFiltered.length, 'localOptimistic=', localOptimistic.length, 'pendingDeletes=', deletedItemIdsRef.current.size);
          return [...serverFiltered, ...localOptimistic];
        });
        
        // Update vehicle flags from summary
        const summary = data.summary || data;
        setHasVehicleItems(!!summary.hasVehicleItems);
        setVehicleQuoteStatus(summary.vehicleQuoteStatus || 'none');
        setCanProceedToPayment(summary.canProceedToPayment !== false);
        if (summary.serverTotalUsd != null || summary.total_usd != null) {
          setServerTotalUsd(summary.serverTotalUsd ?? summary.total_usd);
        }
        console.log('[CART] vehicle flags:', { hasVehicle: summary.hasVehicleItems, quoteStatus: summary.vehicleQuoteStatus, canProceed: summary.canProceedToPayment });
        
        // Quote requests are now triggered explicitly by user action on the product detail page
      }
    } catch (error) {
      console.error('[CART] Failed to sync cart:', error);
    } finally {
      setLoading(false);
      syncInProgressRef.current = false;

      // If something tried to sync while we were syncing, run once more
      if (pendingSyncRef.current) {
        pendingSyncRef.current = false;
        syncCart();
      }
    }
  }, [user, session]);

  const userId = user?.id;
  useEffect(() => {
    if (userId && initialized) {
      syncCart();
    }
  }, [userId, initialized, syncCart]);

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
      const updated = [...items];
      updated[existingIndex].quantity += item.quantity;
      setItems(updated);
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    // If logged in, add to server then sync (respecting deletedItemIdsRef)
    if (user && session) {
      try {
        let productUrl = item.productUrl;
        if (!productUrl && item.productId) {
          let cleanId = item.productId;
          const lowerCleanId = cleanId.toLowerCase();
          
          if (lowerCleanId.startsWith('amazon_')) {
            cleanId = cleanId.slice(7);
          } else if (lowerCleanId.startsWith('rainforest_')) {
            cleanId = cleanId.slice(11);
          } else if (lowerCleanId.startsWith('ebay_')) {
            cleanId = cleanId.slice(5);
          }
          
          if (item.provider === 'ebay') {
            // Extract numeric item ID from eBay's v1|itemId|variationId format
            const ebayItemId = cleanId.startsWith('v1|') ? cleanId.split('|')[1] : cleanId;
            productUrl = `https://www.ebay.com/itm/${ebayItemId}`;
          } else {
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
        // Resync to get server IDs — deletedItemIdsRef ensures deleted items stay gone
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
    // Track this ID as being deleted BEFORE any async work (with timestamp for TTL)
    deletedItemIdsRef.current.set(id, Date.now());

    // Remove locally immediately
    setItems((prev) => prev.filter((item) => item.id !== id));
    // Also deselect
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (user && session && !id.startsWith('local_')) {
      try {
        await supabase.functions.invoke('mobile-delete-cart-item', {
          body: { cart_item_id: id },
        });
        // Sync after confirmed deletion — filter still active via deletedItemIdsRef
        await syncCart();
      } catch (error) {
        console.error('[CART] Failed to remove item:', error);
      } finally {
        // Keep in the map for 30s TTL — DON'T clear immediately to survive multiple sync cycles
        // The TTL cleanup in syncCart will handle removal after 30 seconds
      }
    } else {
      // Local-only item — keep for a short while in case of race conditions
      // Will be cleaned up by TTL in syncCart
    }
  };

  // clearCart - for general cart clearing: delete server items + clear local state
  const clearCart = async () => {
    console.log('[CART] clearCart called - deleting server items and clearing local state');
    setLoading(true);
    try {
      if (user && session) {
        // Delete each server item (skip local_ optimistic items)
        const serverItems = items.filter(item => !isLocalId(item.id));
        const deletePromises = serverItems.map(item =>
          supabase.functions.invoke('mobile-delete-cart-item', {
            body: { cart_item_id: item.id },
          }).catch(err => console.error('[CART] Failed to delete item during clearCart:', item.id, err))
        );
        await Promise.all(deletePromises);
      }
      // Clear all refs and local state
      deletedItemIdsRef.current = new Map();
      setItems([]);
      setSelectedItemIds(new Set());
    } catch (error) {
      console.error('[CART] clearCart failed:', error);
    } finally {
      setLoading(false);
    }
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
        initialized,
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
        markQuoteRequested: () => setVehicleQuoteStatus('pending'),
        // Item selection
        selectedItemIds,
        toggleItemSelection,
        selectAllItems,
        deselectAllItems,
        selectedItems,
        selectedTotalUsd,
        selectedHasVehicleItems,
        selectedCanProceedToPayment,
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
