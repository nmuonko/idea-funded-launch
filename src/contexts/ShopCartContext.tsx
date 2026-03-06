import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client';
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
  // Server-calculated breakdown (populated for quoted vehicles)
  itemMarginUsd?: number;
  itemShippingUsd?: number;
  itemTotalUsd?: number;
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
const DELETED_IDS_STORAGE_KEY = 'afrishop_deleted_cart_ids_v1';
const DELETED_TTL_MS = 5 * 60 * 1000; // 5 minutes (extended from 30s)

export function ShopCartProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
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

  // --- Race condition fix: track items being deleted with TTL, persisted to sessionStorage ---
  const deletedItemIdsRef = useRef<Map<string, number>>((() => {
    try {
      const stored = sessionStorage.getItem(DELETED_IDS_STORAGE_KEY);
      if (stored) {
        const entries: [string, number][] = JSON.parse(stored);
        const now = Date.now();
        return new Map(entries.filter(([, ts]) => now - ts < DELETED_TTL_MS));
      }
    } catch (e) {
      console.error('[CART] Failed to parse deleted IDs from sessionStorage:', e);
    }
    return new Map();
  })());

  // Persist deletedItemIds to sessionStorage whenever it changes
  const persistDeletedIds = useCallback(() => {
    try {
      const entries = Array.from(deletedItemIdsRef.current.entries());
      sessionStorage.setItem(DELETED_IDS_STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.error('[CART] Failed to persist deleted IDs:', e);
    }
  }, []);

  // --- Sync lock: prevent overlapping syncCart() calls ---
  const syncInProgressRef = useRef(false);
  const pendingSyncRef = useRef(false);

  // --- Only force loading=true on first server hydration, not on token refresh ---
  const didInitialServerHydrateRef = useRef(false);

  // --- Item selection state ---
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Keep selectedItemIds in sync with items (auto-select new items, remove stale selections)
  // Vehicle items that need a quote are NOT auto-selected so they don't block checkout for other items
  useEffect(() => {
    setSelectedItemIds(prev => {
      const currentIds = new Set(items.map(i => i.id));
      const next = new Set<string>();
      // Keep existing selections that still exist
      for (const id of prev) {
        if (currentIds.has(id)) next.add(id);
      }
      // Auto-select any new items not previously known
      for (const item of items) {
        if (!prev.has(item.id) && !deletedItemIdsRef.current.has(item.id)) {
          // Skip auto-selecting vehicle items that need a quote
          const needsQuote = item.isVehicle && vehicleQuoteStatus !== 'quoted';
          if (!needsQuote) {
            next.add(item.id);
          }
        }
      }
      return next;
    });
  }, [items, vehicleQuoteStatus]);

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
    if (user && !didInitialServerHydrateRef.current) {
      // First mount for logged-in user: keep loading=true until syncCart finishes
      didInitialServerHydrateRef.current = true;
      setLoading(true);
      console.log('[CART] init: logged-in user, loading=true for initial hydration');
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
          `${SUPABASE_URL}/functions/v1/mobile-public-config`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
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
              vehicleMarkupPercent: data.markup?.vehicleValue ?? data.markupVehiclePercent ?? data.markup?.value ?? 15,
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

  // Canonical dedup key — normalize URL-based IDs so local optimistic items match server items
  const canonicalItemKey = (item: CartItem) => {
    // Prefer productUrl (most reliable), then product_url, then productId
    const urlOrId = item.productUrl || (item as any).product_url || (item as any).canonical_url || item.productId || 'unknown';
    // Strip protocol & trailing slashes for consistency
    const normalized = urlOrId.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const provider = (item.provider || 'unknown').toLowerCase();
    return [provider, normalized].join('|');
  };

  // Sync cart when user logs in — filters out deleted items, preserves optimistic local items
  const syncCart = useCallback(async () => {
    if (!user || !sessionRef.current) return;

    // Lock: avoid overlapping syncs
    if (syncInProgressRef.current) {
      pendingSyncRef.current = true;
      return;
    }
    syncInProgressRef.current = true;
    
    setLoading(true);
    try {
      console.log('[CART] syncing with server for user=', user.id);
      const { data, error } = await supabase.functions.invoke('mobile-cart', { body: { action: 'get_cart' } });
      
      if (error) throw error;
      
      if (data?.activeItems) {
        const mappedItems: CartItem[] = data.activeItems.map((item: any) => {
          const isQuotedVehicle = !!(item.vehicleQuoteApplied || item.vehicle_quote_applied);
          const serverMargin = item.itemMarginUsd || item.markup_fee_usd || 0;
          const serverShipping = item.itemShippingUsd || item.shippingFeeUsd || item.shipping_fee_usd || item.shippingCost || 0;
          const serverTotal = item.itemTotalUsd || item.lineTotalUsd || item.total_price_usd || 0;
          const basePriceUsd = item.basePriceUsd || item.base_price_usd || 0;

          return {
            id: item.id,
            productId: item.productUrl || item.product_url,
            provider: item.store || 'unknown',
            title: item.title || item.productTitle || 'Product',
            imageUrl: item.image_url || item.mainImageUrl || '',
            // For quoted vehicles, use the full line total so cart totals are accurate
            priceUsd: (isQuotedVehicle && serverTotal > 0) ? serverTotal : basePriceUsd,
            quantity: item.quantity || 1,
            productUrl: item.productUrl || item.product_url,
            isVehicle: item.isVehicle || item.is_vehicle || false,
            requiresManualQuote: item.requiresManualQuote || item.requires_manual_quote || false,
            vehicleQuoteApplied: isQuotedVehicle,
            // Server-calculated breakdown
            itemMarginUsd: serverMargin,
            itemShippingUsd: serverShipping,
            itemTotalUsd: serverTotal,
          };
        });

        // CRITICAL: Filter out items that are currently being deleted locally (with TTL cleanup)
        const now = Date.now();
        // Clean up expired entries
        for (const [delId, ts] of deletedItemIdsRef.current) {
          if (now - ts > DELETED_TTL_MS) deletedItemIdsRef.current.delete(delId);
        }
        persistDeletedIds();
        const serverFiltered = mappedItems.filter(item => !deletedItemIdsRef.current.has(item.id));

        // CRITICAL: Server is sole source of truth — drop ALL local_ items unconditionally
        setItems(() => {
          console.log('[CART] sync: server=', serverFiltered.length, 'pendingDeletes=', deletedItemIdsRef.current.size, '(all local_ items dropped)');
          return serverFiltered;
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
  }, [user]);

  const userId = user?.id;
  useEffect(() => {
    if (userId && initialized) {
      syncCart();
    }
  }, [userId, initialized, syncCart]);

  // Build the canonical product URL that the server will store
  const buildServerProductUrl = useCallback((item: Omit<CartItem, 'id'>) => {
    if (item.productUrl) return item.productUrl;
    if (!item.productId) return null;

    let cleanId = item.productId;
    const lower = cleanId.toLowerCase();
    if (lower.startsWith('amazon_')) cleanId = cleanId.slice(7);
    else if (lower.startsWith('rainforest_')) cleanId = cleanId.slice(11);
    else if (lower.startsWith('ebay_')) cleanId = cleanId.slice(5);

    if (item.provider === 'ebay') {
      const ebayItemId = cleanId.startsWith('v1|') ? cleanId.split('|')[1] : cleanId;
      return `https://www.ebay.com/itm/${ebayItemId}`;
    }
    return `https://www.amazon.com/dp/${cleanId}`;
  }, []);

  const addItem = async (item: Omit<CartItem, 'id'>) => {
    // Build the SAME canonical URL that gets sent to the server
    const resolvedUrl = buildServerProductUrl(item);

    const newItem: CartItem = {
      ...item,
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productUrl: resolvedUrl || item.productId,
    };

    // Dedup INSIDE the updater so rapid clicks can't produce duplicates
    const newKey = canonicalItemKey(newItem);
    setItems(prev => {
      const existingIndex = prev.findIndex(i => canonicalItemKey(i) === newKey);
      if (existingIndex >= 0) {
        return prev.map((it, idx) =>
          idx === existingIndex ? { ...it, quantity: it.quantity + item.quantity } : it
        );
      }
      return [...prev, newItem];
    });

    // If logged in, add to server then sync silently (no loading spinner)
    if (user && sessionRef.current) {
      if (!resolvedUrl) {
        console.error('[CART] Cannot sync item without productUrl:', item);
        return;
      }

      try {
        await supabase.functions.invoke('mobile-cart', {
          body: {
            action: 'add_item',
            productUrl: resolvedUrl,
            productPrice: item.priceUsd,
            quantity: item.quantity,
            productTitle: item.title,
            productImageUrl: item.imageUrl,
          },
        });
        // syncCart will drop all local_ items — no need to manually filter here
      } catch (error) {
        console.error('[CART] Failed to add item to server:', error);
      }
      // Background sync to get server IDs — no await, no loading spinner
      syncCart();
    }
  };

  const updateQuantity = async (id: string, quantity: number) => {
    if (quantity <= 0) {
      return removeItem(id);
    }

    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity } : item))
    );

    if (user && sessionRef.current && !id.startsWith('local_')) {
      try {
        await supabase.functions.invoke('mobile-cart', {
          body: { action: 'update_item', item_id: id, quantity },
        });
      } catch (error) {
        console.error('[CART] Failed to update quantity:', error);
      }
    }
  };

  const removeItem = async (id: string) => {
    // Track this ID as being deleted BEFORE any async work (with timestamp for TTL)
    deletedItemIdsRef.current.set(id, Date.now());
    persistDeletedIds();

    // Snapshot the item for potential rollback
    const removedItem = items.find(item => item.id === id);

    // Remove locally immediately (optimistic)
    setItems((prev) => prev.filter((item) => item.id !== id));
    // Also deselect
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (user && sessionRef.current && !id.startsWith('local_')) {
      try {
        const { error } = await supabase.functions.invoke('mobile-cart', {
          body: { action: 'delete_item', item_id: id },
        });
        if (error) throw error;
        // Server confirmed deletion — remove from deleted IDs (it's gone for real)
        deletedItemIdsRef.current.delete(id);
        persistDeletedIds();
        // Sync after confirmed deletion
        await syncCart();
      } catch (error) {
        console.error('[CART] Failed to remove item from server:', error);
        // ROLLBACK: restore the item to the UI since the server delete failed
        if (removedItem) {
          setItems(prev => {
            // Only restore if it's not already back (e.g. from a sync)
            if (prev.some(i => i.id === id)) return prev;
            return [...prev, removedItem];
          });
          toast.error('Failed to remove item. Please try again.');
        }
        // Keep in deleted IDs map so it stays hidden until TTL expires
        // This prevents the item from flickering back during syncs
      }
    }
  };

  // clearCart - for general cart clearing: delete server items + clear local state
  const clearCart = async () => {
    console.log('[CART] clearCart called - deleting server items and clearing local state');
    setLoading(true);
    try {
      if (user && sessionRef.current) {
        // Delete each server item (skip local_ optimistic items)
        const serverItems = items.filter(item => !isLocalId(item.id));
        const deletePromises = serverItems.map(item =>
          supabase.functions.invoke('mobile-cart', {
            body: { action: 'delete_item', item_id: item.id },
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
