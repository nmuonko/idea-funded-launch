import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, Plus, Trash2, Send, Save, Eye, Loader2, Mail, Link2, ShoppingBag, Flame, ArrowRight, CheckSquare, RefreshCw, AlertCircle, FileText, BarChart3, PackagePlus, Check, ExternalLink, Copy, LinkIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { allInclusivePrice, type FeeConfig } from '@/lib/allInclusivePrice';
import type { ShippingCategoryRow } from '@/lib/shippingCategoryDetector';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { HotProductAnalytics } from '@/components/admin/dashboard/HotProductAnalytics';

function inferProvider(url: string): string | null {
  if (/amazon\.\w/.test(url)) return 'amazon';
  if (/walmart\.com/.test(url)) return 'walmart';
  if (/temu\.com/.test(url)) return 'temu';
  if (/shein\.com/.test(url)) return 'shein';
  if (/ebay\.com/.test(url)) return 'ebay';
  return null;
}

function inferProductId(url: string): string | null {
  const asinMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  if (asinMatch) return asinMatch[1];
  const walmartMatch = url.match(/\/ip\/[^/]*?\/(\d+)/);
  if (walmartMatch) return walmartMatch[1];
  return null;
}

interface ShowcaseProduct {
  id: string;
  title: string;
  image_url: string;
  price_usd: number;
  markup_usd: number;
  shipping_usd: number;
  total_price_usd: number;
  product_url: string;
  provider: string;
  provider_product_id: string;
  sort_order: number;
  is_active: boolean;
}

interface FeeSettings {
  markupPercent: number;
  vehicleMarkupPercent: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  shippingRatePerKg: number;
  shippingCategories: ShippingCategoryRow[];
}

interface Campaign {
  id: string;
  title: string;
  status: string;
  products: any[];
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
}

interface DeliveryLog {
  id: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function toHighResImage(url: string): string {
  if (!url) return url;
  if (url.includes('amazon.com') || url.includes('media-amazon.com')) {
    return url
      .replace(/\._[A-Z]{2}_[A-Z0-9_]+_\./, '._SL1500_.')
      .replace(/\._S[SXLY]\d+_\./, '._SL1500_.')
      .replace(/\._AC_[A-Z0-9_]+_\./, '._SL1500_.');
  }
  if (url.includes('ebayimg.com')) {
    return url.replace(/\/s-l\d+\./, '/s-l1600.');
  }
  return url;
}

function calcProductTotals(basePrice: number, fees: FeeSettings, productTitle?: string, categoryKey?: string | null): { markup: number; shipping: number; total: number } {
  const feeConfig: FeeConfig = {
    markupPercent: fees.markupPercent,
    shippingBaseFeeUsd: fees.shippingBaseFeeUsd,
    shippingPercent: fees.shippingPercent,
    shippingRatePerKg: fees.shippingRatePerKg,
    shippingCategories: fees.shippingCategories,
  };
  const total = allInclusivePrice(basePrice, feeConfig, 1, null, productTitle, categoryKey);
  const markupRate = fees.markupPercent > 1 ? fees.markupPercent / 100 : fees.markupPercent;
  const markup = Math.round(basePrice * markupRate * 100) / 100;
  const shipping = Math.round((total - basePrice - markup) * 100) / 100;
  return { markup, shipping, total };
}

export default function HotProducts() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (en: string, fr: string) => language === 'fr' ? fr : en;

  // Showcase state
  const [showcaseProducts, setShowcaseProducts] = useState<ShowcaseProduct[]>([]);
  const [loadingShowcase, setLoadingShowcase] = useState(true);
  const [savingShowcase, setSavingShowcase] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [feeSettings, setFeeSettings] = useState<FeeSettings>({ markupPercent: 15, vehicleMarkupPercent: 15, shippingBaseFeeUsd: 20, shippingPercent: 10, shippingRatePerKg: 20, shippingCategories: [] });

  // Campaign state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [selectedForCampaign, setSelectedForCampaign] = useState<Set<string>>(new Set());
  const [campaignTitle, setCampaignTitle] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('storefront');
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLog[]>([]);
  const [viewingCampaignId, setViewingCampaignId] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Add to Catalog state
  const [catalogUrl, setCatalogUrl] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('');
  const [catalogExtracting, setCatalogExtracting] = useState(false);
  const [catalogResult, setCatalogResult] = useState<any>(null);
  const [catalogManualTitle, setCatalogManualTitle] = useState('');
  const [catalogManualPrice, setCatalogManualPrice] = useState('');
  const [catalogHistory, setCatalogHistory] = useState<Array<{ title: string; provider: string; price: number; imageUrl: string; cached: boolean; url: string }>>([]);

  // Link Generator state
  const [linkGenUrl, setLinkGenUrl] = useState('');
  const [linkGenExtracting, setLinkGenExtracting] = useState(false);
  const [generatedLinks, setGeneratedLinks] = useState<Array<{ id: string; title: string; image_url: string; price_usd: number; total_price_usd: number; checkoutUrl: string; product_url: string }>>([]);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [linkGenExtracted, setLinkGenExtracted] = useState<{ title: string; image_url: string; price: number; provider: string; pid: string; url: string } | null>(null);
  const [linkGenManualPrice, setLinkGenManualPrice] = useState('');
  const [linkGenManualTitle, setLinkGenManualTitle] = useState('');
  const [linkGenPriceEditable, setLinkGenPriceEditable] = useState(false);

  useEffect(() => {
    loadShowcase();
    loadCampaigns();
    loadFeeSettings();
    loadGeneratedLinks();
  }, []);

  async function loadFeeSettings() {
    const [settingsRes, categoriesRes] = await Promise.all([
      supabase.from('settings' as any).select('markup_percent, shipping_base_fee_usd, shipping_percent, shipping_rate_per_kg, category_markups').limit(1).single(),
      supabase.from('shipping_item_types' as any).select('key, label, est_weight_kg, flat_shipping_usd, shipping_buffer_percent, requires_manual_quote').eq('active', true).order('label'),
    ]);
    const d = (settingsRes.data as any) || {};
    const cats: ShippingCategoryRow[] = ((categoriesRes.data as any[]) || []).map((c: any) => ({
      key: c.key,
      est_weight_kg: Number(c.est_weight_kg) || 0,
      flat_shipping_usd: c.flat_shipping_usd != null ? Number(c.flat_shipping_usd) : null,
      shipping_buffer_percent: Number(c.shipping_buffer_percent) || 0,
      requires_manual_quote: c.requires_manual_quote || false,
    }));
    setFeeSettings({
      markupPercent: d.markup_percent ?? 15,
      vehicleMarkupPercent: (d.category_markups as any)?.vehicles ?? d.markup_percent ?? 15,
      shippingBaseFeeUsd: d.shipping_base_fee_usd ?? 20,
      shippingPercent: d.shipping_percent ?? 10,
      shippingRatePerKg: d.shipping_rate_per_kg ?? 20,
      shippingCategories: cats,
    });
  }

  async function loadShowcase() {
    setLoadingShowcase(true);
    const { data } = await (supabase
      .from('hot_products_showcase')
      .select('*') as any)
      .or('link_source.eq.storefront,link_source.is.null')
      .order('sort_order', { ascending: true });
    if (data) setShowcaseProducts(data as any);
    setLoadingShowcase(false);
  }

  async function loadCampaigns() {
    setLoadingCampaigns(true);
    const { data } = await supabase
      .from('hot_product_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setCampaigns(data.map(c => ({ ...c, products: (c.products as any) || [], error_message: (c as any).error_message || null })));
    setLoadingCampaigns(false);
  }

  async function loadDeliveryLogs(campaignId: string) {
    setLoadingLogs(true);
    setViewingCampaignId(campaignId);
    const { data } = await supabase
      .from('hot_product_delivery_logs' as any)
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });
    if (data) setDeliveryLogs(data as any);
    setLoadingLogs(false);
  }

  async function searchProducts() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const { data } = await supabase
      .from('catalog_items')
      .select('id, title, image_url, images, price_usd, provider, provider_product_id')
      .ilike('search_text', `%${searchQuery.trim().toLowerCase()}%`)
      .eq('is_active', true)
      .eq('is_disallowed', false)
      .gt('price_usd', 0)
      .not('image_url', 'is', null)
      .order('popularity_score', { ascending: false, nullsFirst: false })
      .limit(100);
    if (data) setSearchResults(data);
    setSearching(false);
  }

  function getBestImage(item: any): string {
    const images = item.images as any;
    let candidates: string[] = [];
    if (Array.isArray(images)) {
      candidates = images.filter((u: string) => typeof u === 'string');
    } else if (images && typeof images === 'object') {
      candidates = Object.values(images).flat().filter((u: any) => typeof u === 'string') as string[];
    }
    candidates = [item.image_url, ...candidates].filter(Boolean);
    return toHighResImage(candidates[0] || '');
  }

  function addProduct(item: any) {
    if (showcaseProducts.length >= 10) { toast.error('Maximum 10 products'); return; }
    if (showcaseProducts.find(p => p.provider_product_id === item.provider_product_id && p.provider === item.provider)) { toast.error('Already added'); return; }
    const basePrice = item.price_usd || 0;
    const { markup, shipping, total } = calcProductTotals(basePrice, feeSettings, item.title, item.category_key);
    setShowcaseProducts(prev => [...prev, {
      id: `new-${Date.now()}`,
      title: item.title || 'Untitled',
      image_url: getBestImage(item),
      price_usd: basePrice,
      markup_usd: Math.round(markup * 100) / 100,
      shipping_usd: Math.round(shipping * 100) / 100,
      total_price_usd: total,
      product_url: `https://afrishop-usa.com/product/${item.provider}/${item.provider_product_id}`,
      provider: item.provider || '',
      provider_product_id: item.provider_product_id || '',
      sort_order: prev.length,
      is_active: true,
    }]);
  }

  async function extractFromLink() {
    if (!pasteUrl.trim()) return;
    if (showcaseProducts.length >= 10) { toast.error('Maximum 10 products'); return; }
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('extract-price', {
        body: { url: pasteUrl.trim(), forceRefresh: true },
      });
      if (error || !data) { toast.error('Failed to extract'); setExtracting(false); return; }
      const basePrice = data.basePrice || data.price || data.priceUsd || 0;
      const imageUrl = toHighResImage(data.imageUrl || data.image || '');
      const title = data.title || data.name || 'Product';
      const { markup, shipping, total } = calcProductTotals(basePrice, feeSettings, title);
      const prov = data.provider || inferProvider(pasteUrl.trim()) || 'external';
      const pid = data.providerId || inferProductId(pasteUrl.trim()) || '';

      setShowcaseProducts(prev => [...prev, {
        id: `new-${Date.now()}`,
        title,
        image_url: imageUrl,
        price_usd: basePrice,
        markup_usd: Math.round(markup * 100) / 100,
        shipping_usd: Math.round(shipping * 100) / 100,
        total_price_usd: total,
        product_url: (prov && pid) ? `https://afrishop-usa.com/product/${prov}/${pid}` : `https://afrishop-usa.com/paste-link`,
        provider: prov,
        provider_product_id: pid,
        sort_order: prev.length,
        is_active: true,
      }]);
      setPasteUrl('');
      toast.success('Product extracted!');
    } catch {
      toast.error('Extraction failed');
    }
    setExtracting(false);
  }

  async function extractAndCacheToCatalog(manualOverride = false) {
    if (!catalogUrl.trim()) return;
    setCatalogExtracting(true);
    if (!manualOverride) setCatalogResult(null);
    try {
      const invokeBody: any = {
        url: catalogUrl.trim(),
        forceRefresh: true,
        cacheToCatalog: true,
        categoryKey: catalogCategory.trim() || null,
      };
      // Pass manual overrides if provided
      if (manualOverride) {
        if (catalogManualTitle.trim()) invokeBody.manualTitle = catalogManualTitle.trim();
        if (catalogManualPrice.trim()) invokeBody.manualPrice = catalogManualPrice.trim();
      }
      const { data, error } = await supabase.functions.invoke('extract-price', {
        body: invokeBody,
      });
      if (error || !data) {
        toast.error(t('Failed to extract product', 'Échec de l\'extraction'));
        setCatalogExtracting(false);
        return;
      }
      setCatalogResult(data);
      if (data.cached) {
        toast.success(t('Product added to catalog!', 'Produit ajouté au catalogue !'));
        setCatalogHistory(prev => [{
          title: data.title || 'Unknown',
          provider: data.provider || 'external',
          price: data.price || 0,
          imageUrl: data.imageUrl || '',
          cached: true,
          url: catalogUrl.trim(),
        }, ...prev].slice(0, 20));
        setCatalogUrl('');
        setCatalogCategory('');
        setCatalogManualTitle('');
        setCatalogManualPrice('');
      } else if (!data.price || data.price <= 0) {
        toast.error(t('Could not extract price — enter manually below', 'Prix non trouvé — entrez-le manuellement ci-dessous'));
      } else if (!data.title) {
        toast.error(t('Could not extract title — enter manually below', 'Titre non trouvé — entrez-le manuellement ci-dessous'));
      } else {
        toast.error(t('Product extracted but caching failed', 'Produit extrait mais mise en cache échouée'));
      }
    } catch {
      toast.error(t('Extraction failed', 'Échec de l\'extraction'));
    }
    setCatalogExtracting(false);
  }

  async function loadGeneratedLinks() {
    const { data } = await (supabase
      .from('hot_products_showcase')
      .select('*') as any)
      .eq('link_source', 'link_generator')
      .order('created_at', { ascending: false });
    if (data) {
      setGeneratedLinks((data as any[]).map(d => ({
        id: d.id,
        title: d.title,
        image_url: d.image_url || '',
        price_usd: d.price_usd || 0,
        total_price_usd: d.total_price_usd || 0,
        checkoutUrl: `${window.location.origin}/checkout?hp=${d.id}`,
        product_url: d.product_url || '',
      })));
    }
  }

  async function extractLinkGenProduct() {
    if (!linkGenUrl.trim()) return;
    setLinkGenExtracting(true);
    setLinkGenExtracted(null);
    setLinkGenPriceEditable(false);
    setLinkGenManualPrice('');
    setLinkGenManualTitle('');
    try {
      const { data, error } = await supabase.functions.invoke('extract-price', {
        body: { url: linkGenUrl.trim(), forceRefresh: true },
      });
      const basePrice = data?.basePrice || data?.price || data?.priceUsd || 0;
      const imageUrl = toHighResImage(data?.imageUrl || data?.image || '');
      const title = data?.title || data?.name || '';
      const prov = data?.provider || inferProvider(linkGenUrl.trim()) || 'external';
      const pid = data?.providerId || inferProductId(linkGenUrl.trim()) || '';

      if (error || !data || basePrice <= 0) {
        setLinkGenPriceEditable(true);
      }
      if (!title) {
        setLinkGenManualTitle('');
      }

      setLinkGenExtracted({
        title: title || '',
        image_url: imageUrl,
        price: basePrice,
        provider: prov,
        pid,
        url: linkGenUrl.trim(),
      });
      if (basePrice > 0) setLinkGenManualPrice(basePrice.toFixed(2));
    } catch {
      setLinkGenPriceEditable(true);
      setLinkGenExtracted({ title: '', image_url: '', price: 0, provider: inferProvider(linkGenUrl.trim()) || 'external', pid: inferProductId(linkGenUrl.trim()) || '', url: linkGenUrl.trim() });
    }
    setLinkGenExtracting(false);
  }

  async function saveLinkGenProduct() {
    if (!linkGenExtracted) return;
    const finalTitle = linkGenManualTitle.trim() || linkGenExtracted.title || 'Product';
    const finalPrice = linkGenManualPrice ? parseFloat(linkGenManualPrice) : linkGenExtracted.price;
    if (!finalPrice || finalPrice <= 0) { toast.error(t('Enter a valid price', 'Entrez un prix valide')); return; }

    setLinkGenExtracting(true);
    try {
      const { markup, shipping, total } = calcProductTotals(finalPrice, feeSettings, finalTitle);
      await supabase.auth.refreshSession();
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) { toast.error('Session expired'); setLinkGenExtracting(false); return; }

      const prov = linkGenExtracted.provider;
      const pid = linkGenExtracted.pid;
      const { data: inserted, error: insertErr } = await supabase
        .from('hot_products_showcase')
        .insert({
          title: finalTitle,
          image_url: linkGenExtracted.image_url,
          price_usd: finalPrice,
          markup_usd: Math.round(markup * 100) / 100,
          shipping_usd: Math.round(shipping * 100) / 100,
          total_price_usd: total,
          product_url: (prov && pid) ? `https://afrishop-usa.com/product/${prov}/${pid}` : linkGenExtracted.url,
          provider: prov,
          provider_product_id: pid,
          sort_order: 99,
          is_active: true,
          created_by: currentUser.id,
          link_source: 'link_generator',
        } as any)
        .select('id')
        .single();

      if (insertErr || !inserted) { toast.error('Failed to save: ' + (insertErr?.message || '')); setLinkGenExtracting(false); return; }

      const checkoutUrl = `${window.location.origin}/checkout?hp=${inserted.id}`;
      setGeneratedLinks(prev => [{ id: inserted.id, title: finalTitle, image_url: linkGenExtracted.image_url, price_usd: finalPrice, total_price_usd: total, checkoutUrl, product_url: linkGenExtracted.url }, ...prev]);
      setLinkGenUrl('');
      setLinkGenExtracted(null);
      setLinkGenManualPrice('');
      setLinkGenManualTitle('');
      navigator.clipboard.writeText(checkoutUrl);
      setCopiedLinkId(inserted.id);
      setTimeout(() => setCopiedLinkId(null), 3000);
      toast.success(t('Link generated & copied!', 'Lien généré et copié !'));
    } catch {
      toast.error('Failed to generate link');
    }
    setLinkGenExtracting(false);
  }

  async function deleteLinkGenProduct(id: string) {
    await supabase.from('hot_products_showcase').delete().eq('id', id);
    setGeneratedLinks(prev => prev.filter(l => l.id !== id));
    toast.success(t('Deleted', 'Supprimé'));
  }

  function removeProduct(id: string) {
    setShowcaseProducts(prev => prev.filter(p => p.id !== id));
  }

  function updateField(id: string, field: keyof ShowcaseProduct, value: any) {
    setShowcaseProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      // Recalculate total when individual fields change
      if (field === 'price_usd' || field === 'markup_usd' || field === 'shipping_usd') {
        const price = field === 'price_usd' ? value : p.price_usd;
        const markup = field === 'markup_usd' ? value : p.markup_usd;
        const ship = field === 'shipping_usd' ? value : p.shipping_usd;
        updated.total_price_usd = Math.round((price + markup + ship) * 100) / 100;
      }
      return updated;
    }));
  }

  function recalcDefaults(id: string) {
    setShowcaseProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const { markup, shipping, total } = calcProductTotals(p.price_usd, feeSettings, p.title);
      return { ...p, markup_usd: Math.round(markup * 100) / 100, shipping_usd: Math.round(shipping * 100) / 100, total_price_usd: total };
    }));
  }

  async function saveShowcase() {
    setSavingShowcase(true);
    await supabase.auth.refreshSession();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) { toast.error('Session expired'); setSavingShowcase(false); return; }

    // Delete only storefront products (preserve link_generator entries)
    await (supabase.from('hot_products_showcase').delete() as any).neq('id', '00000000-0000-0000-0000-000000000000').neq('link_source', 'link_generator');

    if (showcaseProducts.length > 0) {
      const rows = showcaseProducts.map((p, i) => ({
        title: p.title,
        image_url: p.image_url,
        price_usd: p.price_usd,
        markup_usd: p.markup_usd,
        shipping_usd: p.shipping_usd,
        total_price_usd: p.total_price_usd,
        product_url: p.product_url,
        provider: p.provider,
        provider_product_id: p.provider_product_id,
        sort_order: i,
        is_active: true,
        created_by: currentUser.id,
      }));
      const { error } = await supabase.from('hot_products_showcase').insert(rows);
      if (error) { toast.error('Failed: ' + error.message); setSavingShowcase(false); return; }
    }

    toast.success(t('Storefront products saved!', 'Produits vitrine sauvegardés !'));
    loadShowcase();
    setSavingShowcase(false);
  }

  // Campaign functions
  function toggleCampaignProduct(id: string) {
    setSelectedForCampaign(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllForCampaign() {
    if (selectedForCampaign.size === showcaseProducts.length) {
      setSelectedForCampaign(new Set());
    } else {
      setSelectedForCampaign(new Set(showcaseProducts.map(p => p.id)));
    }
  }

  async function saveCampaignDraft() {
    if (!campaignTitle.trim()) { toast.error('Enter a campaign title'); return; }
    if (selectedForCampaign.size === 0) { toast.error('Select at least 1 product'); return; }
    setSaving(true);
    await supabase.auth.refreshSession();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) { toast.error('Session expired'); setSaving(false); return; }

    const products = showcaseProducts.filter(p => selectedForCampaign.has(p.id));
    const { error } = await supabase.from('hot_product_campaigns').insert({
      title: campaignTitle,
      status: 'draft',
      products: products as any,
      created_by: currentUser.id,
    });
    if (error) toast.error('Failed: ' + error.message);
    else { toast.success('Campaign draft saved'); setCampaignTitle(''); setSelectedForCampaign(new Set()); loadCampaigns(); }
    setSaving(false);
  }

  async function approveAndSend(campaignId: string) {
    setSending(true);
    try {
      await supabase.from('hot_product_campaigns').update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() }).eq('id', campaignId);
      toast.info('Campaign sending started...');
      const { data, error } = await supabase.functions.invoke('send-hot-products-email', { body: { campaignId } });
      if (error) {
        toast.error('Send failed: ' + error.message);
      } else {
        const result = data as any;
        if (result.error) {
          toast.error('Send failed: ' + result.error);
        } else {
          toast.success(`Campaign complete! ${result.sent || 0} sent, ${result.failed || 0} failed out of ${result.total || 0} recipients.`);
        }
      }
    } catch (err) {
      toast.error('Send failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    loadCampaigns();
    setSending(false);
  }

  async function retryCampaign(campaignId: string) {
    setSending(true);
    toast.info('Retrying campaign...');
    const { data, error } = await supabase.functions.invoke('send-hot-products-email', { body: { campaignId } });
    if (error) toast.error('Retry failed: ' + error.message);
    else {
      const result = data as any;
      if (result.error) toast.error('Retry failed: ' + result.error);
      else toast.success(`Retry complete! ${result.sent || 0} sent, ${result.failed || 0} failed.`);
    }
    loadCampaigns();
    setSending(false);
  }

  const goToCampaignTab = () => {
    setSelectedForCampaign(new Set(showcaseProducts.map(p => p.id)));
    setActiveTab('campaigns');
  };

  const selectedCampaignProducts = showcaseProducts.filter(p => selectedForCampaign.has(p.id));

  const statusColor: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800', approved: 'bg-blue-100 text-blue-800',
    sending: 'bg-orange-100 text-orange-800', sent: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('Hot Products', 'Produits Vedettes')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Manage storefront products & email campaigns separately', 'Gérez les produits vitrine et les campagnes email séparément')}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="storefront" className="gap-2">
            <ShoppingBag className="h-4 w-4" />
            {t('Storefront', 'Vitrine')}
          </TabsTrigger>
          <TabsTrigger value="link-gen" className="gap-2">
            <LinkIcon className="h-4 w-4" />
            {t('Link Generator', 'Générateur de lien')}
          </TabsTrigger>
          <TabsTrigger value="add-catalog" className="gap-2">
            <PackagePlus className="h-4 w-4" />
            {t('Add to Catalog', 'Ajouter au Catalogue')}
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2">
            <Mail className="h-4 w-4" />
            {t('Campaigns', 'Campagnes')}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            {t('Analytics', 'Analytique')}
          </TabsTrigger>
        </TabsList>

        {/* ====== TAB 1: STOREFRONT PRODUCTS ====== */}
        <TabsContent value="storefront" className="space-y-4 mt-4">
          {/* Add products section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Plus className="h-5 w-5" />
                {t('Add Products', 'Ajouter des Produits')} ({showcaseProducts.length}/10)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs defaultValue="catalog" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="catalog"><Search className="h-3.5 w-3.5 mr-1.5" />{t('Catalog', 'Catalogue')}</TabsTrigger>
                  <TabsTrigger value="paste"><Link2 className="h-3.5 w-3.5 mr-1.5" />{t('Paste Link', 'Coller un lien')}</TabsTrigger>
                </TabsList>

                <TabsContent value="catalog" className="space-y-2 mt-3">
                  <div className="flex gap-2">
                    <Input placeholder={t('Search products...', 'Rechercher...')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchProducts()} />
                    <Button onClick={searchProducts} disabled={searching} size="sm">
                      {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                      {searchResults.map(item => (
                        <div key={item.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer" onClick={() => addProduct(item)}>
                          {item.image_url && <img src={toHighResImage(item.image_url)} alt="" className="w-10 h-10 rounded object-cover" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{item.title}</p>
                            <p className="text-xs text-muted-foreground">${item.price_usd?.toFixed(2) || '0.00'}</p>
                          </div>
                          <Plus className="h-4 w-4 text-primary shrink-0" />
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="paste" className="space-y-2 mt-3">
                  <p className="text-xs text-muted-foreground">{t('Paste a link from Amazon, Walmart, SHEIN, etc.', 'Collez un lien Amazon, Walmart, SHEIN, etc.')}</p>
                  <div className="flex gap-2">
                    <Input placeholder="https://www.amazon.com/dp/..." value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && extractFromLink()} />
                    <Button onClick={extractFromLink} disabled={extracting} size="sm">
                      {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Product list with editable price fields */}
          {showcaseProducts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-orange-500" />
                    {t('Showcase Products', 'Produits en Vitrine')}
                  </span>
                  <Badge variant="secondary">{showcaseProducts.length}/10</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {showcaseProducts.map((p, idx) => (
                  <div key={p.id} className="p-3 border rounded-lg space-y-3">
                    <div className="flex items-start gap-3">
                      {p.image_url && <img src={p.image_url} alt="" className="w-16 h-16 rounded object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <Input
                          value={p.title}
                          onChange={e => updateField(p.id, 'title', e.target.value)}
                          className="text-sm font-medium h-7 mb-1"
                          placeholder="Product title"
                        />
                        <p className="text-[10px] text-muted-foreground">{p.provider} · {p.provider_product_id}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeProduct(p.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {/* Editable price breakdown */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t('Item Price', 'Prix article')}</Label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">$</span>
                          <Input
                            type="number"
                            className="h-8 text-sm"
                            value={p.price_usd}
                            onChange={e => updateField(p.id, 'price_usd', parseFloat(e.target.value) || 0)}
                            step="0.01"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t('Markup', 'Marge')}</Label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">$</span>
                          <Input
                            type="number"
                            className="h-8 text-sm"
                            value={p.markup_usd}
                            onChange={e => updateField(p.id, 'markup_usd', parseFloat(e.target.value) || 0)}
                            step="0.01"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t('Shipping', 'Livraison')}</Label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">$</span>
                          <Input
                            type="number"
                            className="h-8 text-sm"
                            value={p.shipping_usd}
                            onChange={e => updateField(p.id, 'shipping_usd', parseFloat(e.target.value) || 0)}
                            step="0.01"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => recalcDefaults(p.id)}>
                          ↻ {t('Reset to defaults', 'Réinitialiser')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 gap-1"
                          onClick={() => {
                            if (p.id.startsWith('new-')) {
                              toast.error(t('Save to Storefront first to generate the link', 'Sauvegardez d\'abord pour générer le lien'));
                              return;
                            }
                            const url = `${window.location.origin}/checkout?hp=${p.id}`;
                            navigator.clipboard.writeText(url);
                            toast.success(t('Link copied!', 'Lien copié !'));
                          }}
                        >
                          <Link2 className="h-3 w-3" />
                          {t('Copy Link', 'Copier le lien')}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 bg-primary/10 rounded px-3 py-1.5 border border-primary/20">
                        <Label className="text-sm font-bold">{t('Total', 'Total')}:</Label>
                        <span className="text-lg font-bold text-primary">${p.total_price_usd.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex gap-2 flex-wrap pt-2">
                  <Button onClick={saveShowcase} disabled={savingShowcase}>
                    {savingShowcase ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    {t('Save to Storefront', 'Sauvegarder en Vitrine')}
                  </Button>
                  <Button variant="outline" onClick={goToCampaignTab}>
                    <Send className="h-4 w-4 mr-2" />
                    {t('Send as Campaign', 'Envoyer en Campagne')}
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ====== LINK GENERATOR TAB ====== */}
        <TabsContent value="link-gen" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                {t('Generate Checkout Link', 'Générer un lien de paiement')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('Paste any product URL from Amazon, Walmart, eBay, etc. We\'ll extract images & price, apply your markup/shipping, and generate a unique checkout link.', 'Collez un lien produit. Nous extrairons images et prix, appliquerons votre marge/livraison, et générerons un lien de paiement unique.')}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Step 1: URL input */}
              <div className="flex gap-2">
                <Input
                  placeholder="https://www.amazon.com/dp/B0..."
                  value={linkGenUrl}
                  onChange={e => setLinkGenUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && extractLinkGenProduct()}
                />
                <Button onClick={extractLinkGenProduct} disabled={linkGenExtracting || !linkGenUrl.trim()}>
                  {linkGenExtracting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                  {t('Extract', 'Extraire')}
                </Button>
              </div>

              {/* Step 2: Extracted product preview with editable fields */}
              {linkGenExtracted && (
                <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                  <div className="flex items-start gap-3">
                    {linkGenExtracted.image_url && (
                      <img src={linkGenExtracted.image_url} alt="" className="w-20 h-20 rounded object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div>
                        <Label className="text-xs">{t('Title', 'Titre')}</Label>
                        <Input
                          value={linkGenManualTitle || linkGenExtracted.title}
                          onChange={e => setLinkGenManualTitle(e.target.value)}
                          placeholder={t('Product title...', 'Titre du produit...')}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">{t('Base Price ($)', 'Prix de base ($)')}</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={linkGenManualPrice || (linkGenExtracted.price > 0 ? linkGenExtracted.price.toFixed(2) : '')}
                            onChange={e => { setLinkGenManualPrice(e.target.value); setLinkGenPriceEditable(true); }}
                            placeholder="0.00"
                            className="h-8 text-sm"
                          />
                          {linkGenExtracted.price <= 0 && (
                            <p className="text-xs text-destructive mt-0.5">{t('Auto-extract failed — enter price manually', 'Extraction échouée — entrez le prix')}</p>
                          )}
                        </div>
                        <div>
                          <Label className="text-xs">{t('Markup', 'Marge')}</Label>
                          <p className="text-sm font-medium mt-1">{feeSettings.markupPercent}%</p>
                        </div>
                         <div>
                          <Label className="text-xs">{t('Shipping', 'Livraison')}</Label>
                          <p className="text-sm font-medium mt-1">{t('Weight-based', 'Par poids')} (${feeSettings.shippingRatePerKg}/kg)</p>
                        </div>
                      </div>
                      {(() => {
                        const p = linkGenManualPrice ? parseFloat(linkGenManualPrice) : linkGenExtracted.price;
                        if (p > 0) {
                          const title = linkGenManualTitle.trim() || linkGenExtracted?.title || '';
                          const { total, shipping } = calcProductTotals(p, feeSettings, title);
                          return <p className="text-sm font-bold text-primary">{t('Final price:', 'Prix final :')} ${total.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">({t('all inclusive', 'tout inclus')})</span></p>;
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  <Button onClick={saveLinkGenProduct} disabled={linkGenExtracting} className="w-full">
                    {linkGenExtracting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LinkIcon className="h-4 w-4 mr-2" />}
                    {t('Generate Link', 'Générer le lien')}
                  </Button>
                </div>
              )}

              {/* Step 3: Persisted generated links */}
              {generatedLinks.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground">{t('Generated Links', 'Liens générés')} ({generatedLinks.length})</h4>
                  {generatedLinks.map(link => (
                    <div key={link.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      {link.image_url && <img src={link.image_url} alt="" className="w-12 h-12 rounded object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{link.title}</p>
                        <p className="text-xs text-muted-foreground">${link.total_price_usd.toFixed(2)} · {t('All inclusive', 'Tout inclus')}</p>
                        <p className="text-xs text-muted-foreground/70 truncate mt-0.5 font-mono">{link.checkoutUrl}</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => {
                            navigator.clipboard.writeText(link.checkoutUrl);
                            setCopiedLinkId(link.id);
                            setTimeout(() => setCopiedLinkId(null), 3000);
                            toast.success(t('Copied!', 'Copié !'));
                          }}
                        >
                          {copiedLinkId === link.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedLinkId === link.id ? t('Copied', 'Copié') : t('Copy', 'Copier')}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteLinkGenProduct(link.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ====== TAB 2: EMAIL CAMPAIGNS ====== */}
        <TabsContent value="campaigns" className="space-y-4 mt-4">
          {/* New Campaign Builder */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mail className="h-5 w-5" />
                {t('New Campaign', 'Nouvelle Campagne')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {showcaseProducts.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('Add products in the Storefront tab first', 'Ajoutez des produits dans l\'onglet Vitrine d\'abord')}</p>
                  <Button variant="link" className="mt-2" onClick={() => setActiveTab('storefront')}>
                    {t('Go to Storefront', 'Aller à la Vitrine')} →
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder={t('Campaign title (e.g. Week of March 17)', 'Titre de la campagne (ex: Semaine du 17 mars)')}
                    value={campaignTitle}
                    onChange={e => setCampaignTitle(e.target.value)}
                  />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">
                        {t('Select products to include', 'Sélectionnez les produits à inclure')} ({selectedForCampaign.size}/{showcaseProducts.length})
                      </Label>
                      <Button variant="ghost" size="sm" className="text-xs h-7" onClick={selectAllForCampaign}>
                        <CheckSquare className="h-3.5 w-3.5 mr-1" />
                        {selectedForCampaign.size === showcaseProducts.length ? t('Deselect All', 'Tout décocher') : t('Select All', 'Tout cocher')}
                      </Button>
                    </div>

                    <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                      {showcaseProducts.map(p => (
                        <label key={p.id} className="flex items-center gap-3 p-2.5 hover:bg-muted/50 cursor-pointer">
                          <Checkbox
                            checked={selectedForCampaign.has(p.id)}
                            onCheckedChange={() => toggleCampaignProduct(p.id)}
                          />
                          {p.image_url && <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{p.title}</p>
                            <p className="text-xs text-muted-foreground">${p.total_price_usd.toFixed(2)}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={saveCampaignDraft} disabled={saving || selectedForCampaign.size === 0} variant="outline">
                      {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                      {t('Save Draft', 'Brouillon')}
                    </Button>
                    {selectedForCampaign.size > 0 && (
                      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline"><Eye className="h-4 w-4 mr-2" />{t('Preview', 'Aperçu')}</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader><DialogTitle>{t('Email Preview', 'Aperçu Email')}</DialogTitle></DialogHeader>
                          <div className="border rounded-lg p-4" dangerouslySetInnerHTML={{ __html: buildPreviewHtml(selectedCampaignProducts) }} />
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Campaign History */}
          <Card>
            <CardHeader><CardTitle className="text-lg">{t('Campaign History', 'Historique')}</CardTitle></CardHeader>
            <CardContent>
              {loadingCampaigns ? <p className="text-sm text-muted-foreground">Loading...</p> : campaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('No campaigns yet', 'Aucune campagne')}</p>
              ) : (
                <div className="space-y-3">
                  {campaigns.map(c => (
                    <div key={c.id} className="p-3 border rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{c.title || 'Untitled'}</p>
                            <Badge className={statusColor[c.status] || ''}>{c.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {c.products.length} {t('products', 'produits')}
                            {(c.status === 'sent' || c.status === 'failed') && ` • ${c.sent_count} sent, ${c.failed_count} failed`}
                            {c.sent_at && ` • ${t('Sent', 'Envoyé')} ${new Date(c.sent_at).toLocaleString()}`}
                            {!c.sent_at && ` • ${new Date(c.created_at).toLocaleDateString()}`}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {c.status === 'draft' && (
                            <Button size="sm" onClick={() => approveAndSend(c.id)} disabled={sending}>
                              {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                              {t('Send', 'Envoyer')}
                            </Button>
                          )}
                          {(c.status === 'failed' || c.status === 'sending') && (
                            <Button size="sm" variant="outline" onClick={() => retryCampaign(c.id)} disabled={sending}>
                              {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                              {t('Retry', 'Réessayer')}
                            </Button>
                          )}
                          {(c.status === 'sent' || c.status === 'failed') && (
                            <Button size="sm" variant="ghost" onClick={() => viewingCampaignId === c.id ? setViewingCampaignId(null) : loadDeliveryLogs(c.id)}>
                              <FileText className="h-4 w-4 mr-1" />
                              {t('Report', 'Rapport')}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Error message */}
                      {c.error_message && (
                        <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{c.error_message}</span>
                        </div>
                      )}

                      {/* Delivery report */}
                      {viewingCampaignId === c.id && (
                        <div className="border rounded-md mt-2">
                          <div className="p-2 bg-muted/50 border-b text-xs font-medium flex justify-between">
                            <span>{t('Delivery Report', 'Rapport de livraison')}</span>
                            {loadingLogs && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          </div>
                          {!loadingLogs && deliveryLogs.length === 0 ? (
                            <p className="text-xs text-muted-foreground p-3">{t('No delivery data available', 'Aucune donnée de livraison')}</p>
                          ) : (
                            <div className="max-h-48 overflow-y-auto divide-y">
                              {deliveryLogs.map(log => (
                                <div key={log.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                                  <span className="truncate flex-1">{log.recipient_email}</span>
                                  <Badge variant={log.status === 'sent' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px] ml-2">
                                    {log.status}
                                  </Badge>
                                  {log.error_message && (
                                    <span className="text-destructive ml-2 truncate max-w-[150px]" title={log.error_message}>{log.error_message}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ====== TAB 2: ADD TO CATALOG ====== */}
        <TabsContent value="add-catalog" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <PackagePlus className="h-5 w-5" />
                {t('Add Product by Link', 'Ajouter un Produit par Lien')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t(
                  'Paste a product link from any store (Amazon, Walmart, SHEIN, eBay, etc). We\'ll extract images, price, and add it to the catalog.',
                  'Collez un lien produit de n\'importe quel magasin (Amazon, Walmart, SHEIN, eBay, etc). Nous extrairons les images, le prix et l\'ajouterons au catalogue.'
                )}
              </p>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">{t('Product URL', 'URL du Produit')}</Label>
                  <Input
                    placeholder="https://www.amazon.com/dp/B0..."
                    value={catalogUrl}
                    onChange={e => setCatalogUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && extractAndCacheToCatalog()}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('Category (optional)', 'Catégorie (optionnel)')}</Label>
                  <Input
                    placeholder={t('e.g. electronics, clothing, phones', 'ex. électronique, vêtements, téléphones')}
                    value={catalogCategory}
                    onChange={e => setCatalogCategory(e.target.value)}
                  />
                </div>
                <Button onClick={() => extractAndCacheToCatalog()} disabled={catalogExtracting || !catalogUrl.trim()} className="w-full">
                  {catalogExtracting ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('Extracting...', 'Extraction...')}</>
                  ) : (
                    <><PackagePlus className="h-4 w-4 mr-2" />{t('Extract & Add to Catalog', 'Extraire & Ajouter au Catalogue')}</>
                  )}
                </Button>
              </div>

              {/* Result preview */}
              {catalogResult && (
                <div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-start gap-3">
                    {catalogResult.imageUrl && (
                      <img src={catalogResult.imageUrl} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{catalogResult.title || 'No title'}</p>
                      <p className="text-xs text-muted-foreground">{catalogResult.provider} · ${catalogResult.price?.toFixed(2) || '0.00'}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {catalogResult.cached ? (
                          <Badge variant="default" className="text-xs gap-1"><Check className="h-3 w-3" />{t('Cached', 'En cache')}</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">{t('Not cached', 'Non mis en cache')}</Badge>
                        )}
                        {catalogResult.images?.length > 0 && (
                          <Badge variant="secondary" className="text-xs">{catalogResult.images.length} {t('images', 'images')}</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Manual override fields when extraction fails */}
                  {!catalogResult.cached && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('Auto-extraction failed. Enter details manually:', 'Extraction auto échouée. Entrez les détails manuellement :')}
                      </p>
                      {(!catalogResult.title) && (
                        <div>
                          <Label className="text-xs">{t('Title', 'Titre')}</Label>
                          <Input
                            placeholder={t('Product title...', 'Titre du produit...')}
                            value={catalogManualTitle}
                            onChange={e => setCatalogManualTitle(e.target.value)}
                          />
                        </div>
                      )}
                      {(!catalogResult.price || catalogResult.price <= 0) && (
                        <div>
                          <Label className="text-xs">{t('Price (USD)', 'Prix (USD)')}</Label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="29.99"
                            value={catalogManualPrice}
                            onChange={e => setCatalogManualPrice(e.target.value)}
                          />
                        </div>
                      )}
                      <Button
                        onClick={() => extractAndCacheToCatalog(true)}
                        disabled={catalogExtracting || (!catalogManualTitle.trim() && !catalogResult.title) || (!catalogManualPrice.trim() && (!catalogResult.price || catalogResult.price <= 0))}
                        variant="secondary"
                        className="w-full"
                      >
                        <PackagePlus className="h-4 w-4 mr-2" />
                        {t('Retry with Manual Data', 'Réessayer avec données manuelles')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent additions */}
          {catalogHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Check className="h-5 w-5 text-green-500" />
                  {t('Recently Added', 'Ajoutés Récemment')} ({catalogHistory.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y max-h-64 overflow-y-auto">
                  {catalogHistory.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 py-2">
                      {item.imageUrl && <img src={item.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.provider} · ${item.price.toFixed(2)}</p>
                      </div>
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </a>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ====== TAB 3: ANALYTICS ====== */}
        <TabsContent value="analytics" className="mt-4">
          <HotProductAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function buildPreviewHtml(products: ShowcaseProduct[]): string {
  const productCells = products.map(p => `
    <td style="text-align:center;vertical-align:top;padding:8px;width:${Math.floor(100/Math.min(products.length, 3))}%;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}" style="width:100%;height:180px;object-fit:cover;display:block;" />` : ''}
        <div style="padding:10px;">
          <p style="font-weight:600;font-size:12px;margin:0 0 2px;color:#1a1a1a;line-height:1.3;">${p.title.length > 45 ? p.title.slice(0, 45) + '…' : p.title}</p>
          <p style="font-size:20px;font-weight:800;color:#e63946;margin:4px 0 2px;">$${p.total_price_usd.toFixed(2)}</p>
          <p style="font-size:9px;color:#666;margin:0 0 8px;">Tout inclus · All-inclusive</p>
          <a href="${p.product_url}${p.product_url.includes('?') ? '&' : '?'}hot=1" style="display:inline-block;background:#e63946;color:#fff;padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Commander</a>
        </div>
      </div>
    </td>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
      <div style="text-align:center;padding:20px;background:#1a1a1a;">
        <img src="https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo-white.png" width="140" alt="AfriShop USA" style="display:inline-block;max-width:140px;" />
      </div>
      <div style="padding:20px;">
        <p style="font-size:14px;color:#333;margin:0 0 6px;line-height:1.5;">Bonjour,</p>
        <p style="font-size:14px;color:#333;margin:0 0 6px;line-height:1.5;">Nous avons sélectionné ces produits pour vous cette semaine. Les prix incluent la livraison en RDC (2 à 4 semaines).</p>
        <p style="font-size:13px;color:#888;margin:0 0 16px;line-height:1.5;">We picked these products for you this week. Prices include delivery to DRC (2-4 weeks).</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${productCells}</tr></table>
      </div>
      <div style="text-align:center;padding:12px;background:#f3f4f6;font-size:10px;color:#999;">
        <p style="margin:2px 0;">AfriShop USA - Achetez aux USA, livré en Afrique</p>
        <p style="margin:2px 0;">&copy; ${new Date().getFullYear()} AfriShop USA</p>
      </div>
    </div>
  `;
}
