import { useState, useEffect, useCallback } from 'react'; // rebuilt
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, Plus, Trash2, Send, Save, Eye, Loader2, Mail, Link2, ShoppingBag, Flame, ArrowRight, CheckSquare, RefreshCw, AlertCircle, FileText, BarChart3, PackagePlus, Check, ExternalLink, Copy, LinkIcon, Pencil, MessageCircle, ImagePlus, X, Upload, MoreHorizontal, Download, ClipboardCopy, ArrowUp, ArrowDown, Image as ImageIcon, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { allInclusivePrice, type FeeConfig } from '@/lib/allInclusivePrice';
import type { ShippingCategoryRow } from '@/lib/shippingCategoryDetector';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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

// Build a canonical source URL on the retailer's site (Amazon, eBay, etc.)
// so orders preserve the original product link instead of an internal /product/... URL.
function buildSourceProductUrl(provider: string, providerProductId: string, fallback?: string): string {
  const prov = (provider || '').toLowerCase();
  const rawId = (providerProductId || '').trim();
  if (prov && rawId) {
    if (prov === 'ebay') {
      const ebayItemId = rawId.startsWith('v1|') ? rawId.split('|')[1] || rawId : rawId;
      return `https://www.ebay.com/itm/${ebayItemId}`;
    }
    if (prov === 'amazon') {
      let cleanId = rawId;
      if (cleanId.toLowerCase().startsWith('amazon_')) cleanId = cleanId.slice(7);
      if (cleanId.toLowerCase().startsWith('rainforest_')) cleanId = cleanId.slice(11);
      return `https://www.amazon.com/dp/${cleanId.toUpperCase()}`;
    }
    if (prov === 'walmart') return `https://www.walmart.com/ip/${rawId}`;
    if (prov === 'shein') return `https://www.shein.com/p-${rawId}.html`;
    if (prov === 'temu') return `https://www.temu.com/${rawId}.html`;
  }
  return fallback || '';
}

// Drag-and-drop wrapper for each generated link row
function SortableLinkRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="absolute left-1 top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground touch-none"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="pl-7">{children}</div>
    </div>
  );
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

interface GeneratedLink {
  id: string;
  title: string;
  image_url: string;
  price_usd: number;
  markup_usd: number;
  shipping_usd: number;
  total_price_usd: number;
  checkoutUrl: string;
  product_url: string;
  description_fr: string;
  gallery_images: string[];
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

function normalizeShareText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function cleanMarketplaceTitle(title: string): string {
  return normalizeShareText(title)
    .replace(/^[^:]{2,40}:\s*/, '')
    .replace(/\s+:\s+[^:]{2,40}$/, '')
    .trim();
}

function getSharePreviewImage(link: Pick<GeneratedLink, 'gallery_images' | 'image_url'>): string {
  return link.gallery_images[0] || link.image_url || '';
}

function getSharePreviewTitle(link: Pick<GeneratedLink, 'description_fr' | 'title'>): string {
  const description = normalizeShareText(link.description_fr);
  if (description) {
    const firstSentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || description;
    return truncateText(firstSentence, 110);
  }
  return truncateText(cleanMarketplaceTitle(link.title) || 'Produit AfriShop', 110);
}

function getSharePreviewDescription(link: Pick<GeneratedLink, 'description_fr' | 'title' | 'total_price_usd'>): string {
  const description = normalizeShareText(link.description_fr);
  if (description) return truncateText(description, 180);
  return `Prix: $${Math.ceil(link.total_price_usd)} · Livraison en RDC incluse`;
}

function getShareUrl(id: string): string {
  return `https://afrishop-usa.com/share/hp/${id}`;
}

async function syncSharePreviewPages(ids?: string[]): Promise<boolean> {
  const { error } = await supabase.functions.invoke('backfill-share-previews', {
    body: ids && ids.length > 0 ? { ids } : {},
  });

  if (error) {
    console.error('Failed to sync share preview pages:', error);
    return false;
  }

  return true;
}

function buildWhatsAppShareMessage(
  link: Pick<GeneratedLink, 'title' | 'total_price_usd' | 'description_fr'>,
  shareUrl: string,
): string {
  const desc = normalizeShareText(link.description_fr) || cleanMarketplaceTitle(link.title) || 'Produit AfriShop';
  return `${desc}\n\n💰 Prix: $${Math.ceil(link.total_price_usd)}\n✅ Livraison en RDC incluse\n\n👉 Commander ici: ${shareUrl}`;
}

function buildCaption(
  link: Pick<GeneratedLink, 'title' | 'total_price_usd' | 'description_fr'>,
  shareUrl: string,
): string {
  const desc = normalizeShareText(link.description_fr) || cleanMarketplaceTitle(link.title) || 'Produit AfriShop';
  const shortDesc = desc.length > 120 ? desc.slice(0, 117).trimEnd() + '…' : desc;
  return `${shortDesc}\n\n💰 $${Math.ceil(link.total_price_usd)} · Livraison incluse 🇨🇩\n\n👉 ${shareUrl}`;
}

function supportsClipboardImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
}

function convertToPngBlob(imageUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          b => b ? resolve(b) : reject(new Error('toBlob failed')),
          'image/png',
        );
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    // Use proxy-friendly URL to avoid CORS issues
    img.src = imageUrl;
  });
}

async function copyImageToClipboard(imageUrl: string): Promise<boolean> {
  if (!supportsClipboardImage()) return false;
  try {
    // Pass a Promise to ClipboardItem so the browser keeps user-activation alive
    // during the async fetch+convert. This is the Chrome-supported pattern.
    const pngPromise = convertToPngBlob(imageUrl);
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngPromise }),
    ]);
    return true;
  } catch (err) {
    console.warn('Clipboard image copy failed:', err);
    return false;
  }
}

async function copyBothToClipboard(imageUrl: string, caption: string): Promise<'full' | 'text-only' | 'failed'> {
  if (!supportsClipboardImage()) {
    try {
      await navigator.clipboard.writeText(caption);
      return 'text-only';
    } catch {
      return 'failed';
    }
  }
  try {
    const pngPromise = convertToPngBlob(imageUrl);
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngPromise,
        'text/plain': new Blob([caption], { type: 'text/plain' }),
      }),
    ]);
    return 'full';
  } catch {
    try {
      await navigator.clipboard.writeText(caption);
      return 'text-only';
    } catch {
      return 'failed';
    }
  }
}

function downloadImage(imageUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = imageUrl;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  const markup = Math.ceil(basePrice * markupRate);
  const shipping = Math.ceil(total - basePrice - markup);
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

  // Link Generator state — hydrate from localStorage so extraction survives refresh
  const storedExtracted = (() => { try { const s = localStorage.getItem('hp_linkgen_extracted'); return s ? JSON.parse(s) : null; } catch { return null; } })();
  const [linkGenUrl, setLinkGenUrl] = useState(() => localStorage.getItem('hp_linkgen_url') || '');
  const [linkGenExtracting, setLinkGenExtracting] = useState(false);
  const [generatedLinks, setGeneratedLinks] = useState<GeneratedLink[]>([]);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [linkGenExtracted, setLinkGenExtracted] = useState<{ title: string; image_url: string; price: number; provider: string; pid: string; url: string; gallery_images?: string[] } | null>(storedExtracted);
  const [linkGenManualPrice, setLinkGenManualPrice] = useState(() => localStorage.getItem('hp_linkgen_price') || (storedExtracted?.price > 0 ? String(storedExtracted.price) : ''));
  const [linkGenManualTitle, setLinkGenManualTitle] = useState(() => localStorage.getItem('hp_linkgen_title') || '');
  const [linkGenPriceEditable, setLinkGenPriceEditable] = useState(() => storedExtracted ? (!storedExtracted.price || storedExtracted.price <= 0) : false);
  const [linkGenFinalOverride, setLinkGenFinalOverride] = useState('');
  const [linkGenManualMarkup, setLinkGenManualMarkup] = useState('');
  const [linkGenManualShipping, setLinkGenManualShipping] = useState('');
  const [linkGenDescFr, setLinkGenDescFr] = useState('');
  const [translatingFr, setTranslatingFr] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editLinkTitle, setEditLinkTitle] = useState('');
  const [editLinkFinalPrice, setEditLinkFinalPrice] = useState('');
  const [editLinkItemPrice, setEditLinkItemPrice] = useState('');
  const [editLinkMarkup, setEditLinkMarkup] = useState('');
  const [editLinkShipping, setEditLinkShipping] = useState('');
  const [editLinkDescFr, setEditLinkDescFr] = useState('');
  const [editLinkGallery, setEditLinkGallery] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newEditImageUrl, setNewEditImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [whatsappPreviewLink, setWhatsappPreviewLink] = useState<string | null>(null);
  const [imageFallbackModal, setImageFallbackModal] = useState<{ imageUrl: string; caption: string; title: string } | null>(null);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [globalMarkupPct, setGlobalMarkupPct] = useState('');
  const [applyingGlobalMarkup, setApplyingGlobalMarkup] = useState(false);

  async function applyGlobalMarkupToAll() {
    const pct = parseFloat(globalMarkupPct);
    if (!isFinite(pct) || pct < 0) { toast.error(t('Enter a valid %', 'Entrez un % valide')); return; }
    if (generatedLinks.length === 0) return;
    const scope = selectedLinkIds.size > 0
      ? generatedLinks.filter(l => selectedLinkIds.has(l.id))
      : generatedLinks;
    if (!confirm(t(`Apply ${pct}% markup to ${scope.length} item(s)?`, `Appliquer ${pct}% de marge à ${scope.length} article(s) ?`))) return;
    setApplyingGlobalMarkup(true);
    const rate = pct / 100;
    const updated: GeneratedLink[] = [];
    const results = await Promise.all(scope.map(async (l) => {
      const base = Number(l.price_usd) || 0;
      const shipping = Number(l.shipping_usd) || 0;
      const markup = Math.ceil(base * rate);
      const total = Math.ceil(base + markup + shipping);
      const { error } = await supabase
        .from('hot_products_showcase')
        .update({ markup_usd: markup, total_price_usd: total } as any)
        .eq('id', l.id);
      if (!error) updated.push({ ...l, markup_usd: markup, total_price_usd: total });
      return !error;
    }));
    setApplyingGlobalMarkup(false);
    const okCount = results.filter(Boolean).length;
    if (okCount > 0) {
      setGeneratedLinks(prev => prev.map(l => updated.find(u => u.id === l.id) || l));
      toast.success(t(`${okCount} updated`, `${okCount} mis à jour`));
    }
    if (okCount < scope.length) toast.error(t(`${scope.length - okCount} failed`, `${scope.length - okCount} échec(s)`));
  }

  function toggleLinkSelection(id: string) {
    setSelectedLinkIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAllLinks() {
    setSelectedLinkIds(prev =>
      prev.size === generatedLinks.length ? new Set() : new Set(generatedLinks.map(l => l.id))
    );
  }
  async function bulkDeleteSelectedLinks() {
    if (selectedLinkIds.size === 0) return;
    const count = selectedLinkIds.size;
    if (!confirm(t(`Delete ${count} selected product(s)?`, `Supprimer ${count} produit(s) sélectionné(s) ?`))) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedLinkIds);
    const { error } = await supabase.from('hot_products_showcase').delete().in('id', ids);
    setBulkDeleting(false);
    if (error) { toast.error(t('Bulk delete failed', 'Échec de la suppression')); return; }
    setGeneratedLinks(prev => prev.filter(l => !selectedLinkIds.has(l.id)));
    setSelectedLinkIds(new Set());
    toast.success(t(`${count} deleted`, `${count} supprimé(s)`));
  }

  async function uploadProductImage(file: File, target: 'extract' | 'edit') {
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `hot-products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('product-images').upload(path, file);
      if (error) { toast.error('Upload failed: ' + error.message); return; }
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      if (target === 'extract' && linkGenExtracted) {
        setLinkGenExtracted({ ...linkGenExtracted, gallery_images: [...(linkGenExtracted.gallery_images || []), publicUrl] });
      } else if (target === 'edit') {
        setEditLinkGallery(prev => [...prev, publicUrl]);
      }
      toast.success(t('Image uploaded', 'Image téléchargée'));
    } catch (e: any) {
      toast.error('Upload error');
    } finally {
      setUploadingImage(false);
    }
  }

  // Persist link generator state to localStorage
  useEffect(() => {
    if (linkGenExtracted) localStorage.setItem('hp_linkgen_extracted', JSON.stringify(linkGenExtracted));
    else localStorage.removeItem('hp_linkgen_extracted');
  }, [linkGenExtracted]);
  useEffect(() => { localStorage.setItem('hp_linkgen_url', linkGenUrl); }, [linkGenUrl]);
  useEffect(() => { localStorage.setItem('hp_linkgen_price', linkGenManualPrice); }, [linkGenManualPrice]);
  useEffect(() => { localStorage.setItem('hp_linkgen_title', linkGenManualTitle); }, [linkGenManualTitle]);

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
    const { data } = await (supabase.rpc('admin_list_hot_products' as any) as any);
    if (data) {
      const filtered = (data as any[])
        .filter((d) => d.link_source === 'storefront' || d.link_source == null)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setShowcaseProducts(filtered as any);
    }
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
      markup_usd: Math.ceil(markup),
      shipping_usd: Math.ceil(shipping),
      total_price_usd: total,
      product_url: buildSourceProductUrl(item.provider, item.provider_product_id, item.product_url),
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
        markup_usd: Math.ceil(markup),
        shipping_usd: Math.ceil(shipping),
        total_price_usd: total,
        product_url: buildSourceProductUrl(prov, pid, pasteUrl.trim()),
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
    const { data } = await (supabase.rpc('admin_list_hot_products' as any) as any);
    if (data) {
      const filtered = (data as any[])
        .filter((d) => d.link_source === 'link_generator')
        .sort((a, b) => {
          const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
          const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      setGeneratedLinks(filtered.map((d: any) => ({
        id: d.id,
        title: d.title,
        image_url: d.image_url || '',
        price_usd: d.price_usd || 0,
        markup_usd: d.markup_usd || 0,
        shipping_usd: d.shipping_usd || 0,
        total_price_usd: d.total_price_usd || 0,
        checkoutUrl: `${window.location.origin}/checkout?hp=${d.id}`,
        product_url: d.product_url || '',
        description_fr: d.description_fr || '',
        gallery_images: d.gallery_images || [],
      })));
    }
  }

  function handleShareOnWhatsApp(link: GeneratedLink) {
    const shareUrl = getShareUrl(link.id);
    const msg = buildWhatsAppShareMessage(link, shareUrl);
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
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
        gallery_images: [imageUrl, ...(data?.galleryImages || data?.images || []).filter((u: string) => typeof u === 'string' && u !== imageUrl)].filter(Boolean).slice(0, 5),
      });
      if (basePrice > 0) setLinkGenManualPrice(basePrice.toFixed(0));

      // Auto-translate title to French — pass the all-inclusive total so the
      // generated description shows the customer-facing price, not the raw item price.
      if (title) {
        const { markup: estMarkup, shipping: estShipping } = calcProductTotals(basePrice, feeSettings, title);
        const estTotal = Math.ceil((basePrice || 0) + estMarkup + estShipping);
        setTranslatingFr(true);
        supabase.functions.invoke('translate-product', { body: { title, price: estTotal || basePrice } })
          .then(({ data: trData }) => {
            if (trData?.description_fr) setLinkGenDescFr(trData.description_fr);
          })
          .catch(() => {})
          .finally(() => setTranslatingFr(false));
      }
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
      const { markup: calcMarkup, shipping: calcShipping } = calcProductTotals(finalPrice, feeSettings, finalTitle);
      const markup = linkGenManualMarkup ? parseFloat(linkGenManualMarkup) : calcMarkup;
      const shipping = linkGenManualShipping ? parseFloat(linkGenManualShipping) : calcShipping;
      const finalOverride = linkGenFinalOverride ? parseFloat(linkGenFinalOverride) : 0;
      const total = finalOverride > 0 ? finalOverride : Math.ceil(finalPrice + markup + shipping);
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
          markup_usd: Math.ceil(markup),
          shipping_usd: Math.ceil(shipping),
          total_price_usd: total,
          product_url: linkGenExtracted.url,
          provider: prov,
          provider_product_id: pid,
          sort_order: 99,
          is_active: true,
          created_by: currentUser.id,
          link_source: 'link_generator',
          description_fr: linkGenDescFr || null,
          gallery_images: linkGenExtracted.gallery_images || null,
        } as any)
        .select('id')
        .single();

      if (insertErr || !inserted) { toast.error('Failed to save: ' + (insertErr?.message || '')); setLinkGenExtracting(false); return; }

      const checkoutUrl = `${window.location.origin}/checkout?hp=${inserted.id}`;
      const savedLink: GeneratedLink = {
        id: inserted.id,
        title: finalTitle,
        image_url: linkGenExtracted.image_url,
        price_usd: finalPrice,
        markup_usd: markup,
        shipping_usd: shipping,
        total_price_usd: total,
        checkoutUrl,
        product_url: linkGenExtracted.url,
        description_fr: linkGenDescFr,
        gallery_images: linkGenExtracted.gallery_images || [],
      };
      const shareUrl = getShareUrl(inserted.id);
      const shareSynced = await syncSharePreviewPages([inserted.id]);
      setGeneratedLinks(prev => [savedLink, ...prev]);
      setLinkGenUrl('');
      setLinkGenExtracted(null);
      setLinkGenManualPrice('');
      setLinkGenManualTitle('');
      setLinkGenFinalOverride('');
      setLinkGenManualMarkup('');
      setLinkGenManualShipping('');
      setLinkGenDescFr('');
      if (!shareSynced) {
        toast.error(t('Product saved, but share page sync failed', 'Produit sauvegardé, mais la page de partage n\'a pas pu être générée'));
        return;
      }
      navigator.clipboard.writeText(shareUrl);
      setCopiedLinkId(inserted.id);
      setTimeout(() => setCopiedLinkId(null), 3000);
      toast.success(t('Share link generated & copied!', 'Lien de partage généré et copié !'));
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

  async function moveLinkGenProduct(id: string, direction: -1 | 1) {
    const idx = generatedLinks.findIndex(l => l.id === id);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= generatedLinks.length) return;
    const reordered = [...generatedLinks];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    setGeneratedLinks(reordered);
    // Persist sort_order for the two swapped rows (and normalize all if needed)
    const updates = reordered.map((l, i) =>
      (supabase.from('hot_products_showcase') as any).update({ sort_order: i }).eq('id', l.id)
    );
    const results = await Promise.all(updates);
    const firstError = results.find((r: any) => r?.error)?.error;
    if (firstError) {
      toast.error(t('Reorder failed', 'Échec du réordonnancement'));
      loadGeneratedLinks();
    }
  }

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleLinksDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = generatedLinks.findIndex(l => l.id === active.id);
    const newIndex = generatedLinks.findIndex(l => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(generatedLinks, oldIndex, newIndex);
    setGeneratedLinks(reordered);
    const updates = reordered.map((l, i) =>
      (supabase.from('hot_products_showcase') as any).update({ sort_order: i }).eq('id', l.id)
    );
    const results = await Promise.all(updates);
    const firstError = (results as any[]).find((r: any) => r?.error)?.error;
    if (firstError) {
      toast.error(t('Reorder failed', 'Échec du réordonnancement'));
      loadGeneratedLinks();
    } else {
      toast.success(t('Order saved', 'Ordre enregistré'));
    }
  }


  function startEditLink(link: GeneratedLink) {
    setEditingLinkId(link.id);
    setEditLinkTitle(link.title);
    setEditLinkItemPrice(String(link.price_usd));
    setEditLinkMarkup(String(link.markup_usd));
    setEditLinkShipping(String(link.shipping_usd));
    setEditLinkFinalPrice(String(link.total_price_usd));
    setEditLinkDescFr(link.description_fr || '');
    setEditLinkGallery([...link.gallery_images]);
    setNewEditImageUrl('');
  }

  async function saveEditLink(id: string) {
    const newTitle = editLinkTitle.trim();
    const newItemPrice = parseFloat(editLinkItemPrice) || 0;
    const newMarkup = parseFloat(editLinkMarkup) || 0;
    const newShipping = parseFloat(editLinkShipping) || 0;
    const newFinal = parseFloat(editLinkFinalPrice) || Math.ceil(newItemPrice + newMarkup + newShipping);
    if (!newTitle || newFinal <= 0) { toast.error(t('Invalid values', 'Valeurs invalides')); return; }
    const { error } = await supabase.from('hot_products_showcase').update({ title: newTitle, price_usd: newItemPrice, markup_usd: newMarkup, shipping_usd: newShipping, total_price_usd: newFinal, description_fr: editLinkDescFr || null, gallery_images: editLinkGallery.length > 0 ? editLinkGallery : null, image_url: editLinkGallery[0] || undefined } as any).eq('id', id);
    if (error) { toast.error('Save failed'); return; }
    const existingLink = generatedLinks.find(link => link.id === id);
    const updatedLink: GeneratedLink = {
      ...(existingLink || {
        id,
        title: newTitle,
        image_url: editLinkGallery[0] || '',
        price_usd: newItemPrice,
        markup_usd: newMarkup,
        shipping_usd: newShipping,
        total_price_usd: newFinal,
        checkoutUrl: `${window.location.origin}/checkout?hp=${id}`,
        product_url: '',
        description_fr: editLinkDescFr,
        gallery_images: editLinkGallery,
      }),
      title: newTitle,
      price_usd: newItemPrice,
      markup_usd: newMarkup,
      shipping_usd: newShipping,
      total_price_usd: newFinal,
      description_fr: editLinkDescFr,
      gallery_images: editLinkGallery,
      image_url: editLinkGallery[0] || existingLink?.image_url || '',
    };
    setGeneratedLinks(prev => prev.map(link => link.id === id ? updatedLink : link));
    const shareSynced = await syncSharePreviewPages([id]);
    setEditingLinkId(null);
    if (!shareSynced) {
      toast.error(t('Updated, but share page sync failed', 'Mis à jour, mais la page de partage n\'a pas pu être régénérée'));
      return;
    }
    toast.success(t('Updated', 'Mis à jour'));
  }

  function removeProduct(id: string) {
    setShowcaseProducts(prev => prev.filter(p => p.id !== id));
  }

  async function toggleShowcaseActive(id: string, next: boolean) {
    // Optimistic update
    setShowcaseProducts(prev => prev.map(p => p.id === id ? { ...p, is_active: next } : p));
    if (id.startsWith('new-')) return; // not yet persisted
    const { error } = await (supabase.from('hot_products_showcase') as any)
      .update({ is_active: next })
      .eq('id', id);
    if (error) {
      toast.error(t('Failed to update visibility', 'Échec de la mise à jour'));
      setShowcaseProducts(prev => prev.map(p => p.id === id ? { ...p, is_active: !next } : p));
      return;
    }
    toast.success(next
      ? t('Visible on Hot Products', 'Visible sur Produits Phares')
      : t('Hidden from Hot Products', 'Masqué des Produits Phares'));
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
        updated.total_price_usd = Math.ceil(price + markup + ship);
      }
      return updated;
    }));
  }

  function recalcDefaults(id: string) {
    setShowcaseProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const { markup, shipping, total } = calcProductTotals(p.price_usd, feeSettings, p.title);
      return { ...p, markup_usd: markup, shipping_usd: shipping, total_price_usd: total };
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

    const shareSynced = await syncSharePreviewPages();
    if (!shareSynced) {
      toast.error(t('Storefront saved, but share pages failed to refresh', 'La vitrine a été sauvegardée, mais les pages de partage n\'ont pas pu être rafraîchies'));
    } else {
      toast.success(t('Storefront products saved!', 'Produits vitrine sauvegardés !'));
    }
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
                            <p className="text-xs text-muted-foreground">${item.price_usd?.toFixed(0) || '0.00'}</p>
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
                            const url = getShareUrl(p.id);
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
                        <span className="text-lg font-bold text-primary">${p.total_price_usd.toFixed(0)}</span>
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
              <div className="flex gap-2 flex-wrap">
                <Input
                  placeholder="https://www.amazon.com/dp/B0..."
                  value={linkGenUrl}
                  onChange={e => setLinkGenUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && extractLinkGenProduct()}
                  className="flex-1 min-w-[200px]"
                />
                <Button onClick={extractLinkGenProduct} disabled={linkGenExtracting || !linkGenUrl.trim()}>
                  {linkGenExtracting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                  {t('Extract', 'Extraire')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setLinkGenExtracted({
                      title: '',
                      image_url: '',
                      price: 0,
                      provider: 'manual',
                      pid: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                      url: '',
                      gallery_images: [],
                    });
                    setLinkGenManualTitle('');
                    setLinkGenManualPrice('');
                    setLinkGenPriceEditable(true);
                  }}
                  disabled={linkGenExtracting}
                >
                  <ImagePlus className="h-4 w-4 mr-2" />
                  {t('Add manually', 'Ajouter manuellement')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                {t('No link? Click "Add manually" to paste images and enter a title and price yourself.', 'Pas de lien ? Cliquez sur « Ajouter manuellement » pour coller des images et saisir un titre et un prix.')}
              </p>


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
                      {/* Product Images Gallery */}
                      <div>
                        <Label className="text-xs flex items-center gap-1">{t('Product Images', 'Images du produit')} ({(linkGenExtracted.gallery_images || []).length})</Label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {(linkGenExtracted.gallery_images || []).map((img, i) => (
                            <div key={i} className="relative group">
                              <img src={img} alt="" className="w-16 h-16 rounded border object-cover" />
                              <button
                                type="button"
                                className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  const updated = (linkGenExtracted.gallery_images || []).filter((_, idx) => idx !== i);
                                  setLinkGenExtracted({ ...linkGenExtracted, gallery_images: updated });
                                }}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1 mt-1">
                          <Input
                            value={newImageUrl}
                            onChange={e => setNewImageUrl(e.target.value)}
                            placeholder={t('Paste image URL or upload...', 'Collez une URL ou téléchargez...')}
                            className="h-7 text-xs flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            disabled={!newImageUrl.trim()}
                            onClick={() => {
                              const url = newImageUrl.trim();
                              if (url) {
                                const current = linkGenExtracted.gallery_images || [];
                                setLinkGenExtracted({ ...linkGenExtracted, gallery_images: [...current, url] });
                                setNewImageUrl('');
                              }
                            }}
                          >
                            <ImagePlus className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            disabled={uploadingImage}
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (e) => {
                                const file = (e.target as HTMLInputElement).files?.[0];
                                if (file) uploadProductImage(file, 'extract');
                              };
                              input.click();
                            }}
                          >
                            {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                      {(() => {
                        const p = linkGenManualPrice ? parseFloat(linkGenManualPrice) : linkGenExtracted.price;
                        if (p <= 0) return null;
                        const title = linkGenManualTitle.trim() || linkGenExtracted?.title || '';
                        const { markup: calcMarkup, shipping: calcShipping, total: calcTotal } = calcProductTotals(p, feeSettings, title);
                        const dispMarkup = linkGenManualMarkup ? parseFloat(linkGenManualMarkup) : calcMarkup;
                        const dispShipping = linkGenManualShipping ? parseFloat(linkGenManualShipping) : calcShipping;
                        const finalOverrideVal = linkGenFinalOverride ? parseFloat(linkGenFinalOverride) : 0;
                        const dispTotal = finalOverrideVal > 0 ? finalOverrideVal : Math.ceil(p + dispMarkup + dispShipping);
                        return null; // rendered below
                      })()}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">{t('Item Price', 'Prix article')}</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              type="number"
                              step="1"
                              value={linkGenManualPrice || (linkGenExtracted.price > 0 ? Math.ceil(linkGenExtracted.price) : '')}
                              onChange={e => { setLinkGenManualPrice(e.target.value); setLinkGenPriceEditable(true); }}
                              placeholder="0"
                              className="h-8 text-sm pl-6"
                            />
                          </div>
                          {linkGenExtracted.price <= 0 && (
                            <p className="text-xs text-destructive mt-0.5">{t('Enter price manually', 'Entrez le prix')}</p>
                          )}
                        </div>
                        <div>
                          <Label className="text-xs">{t('Markup', 'Marge')}</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              type="number"
                              step="1"
                              value={linkGenManualMarkup || (() => {
                                const p = linkGenManualPrice ? parseFloat(linkGenManualPrice) : linkGenExtracted.price;
                                if (p <= 0) return '';
                                const title = linkGenManualTitle.trim() || linkGenExtracted?.title || '';
                                return calcProductTotals(p, feeSettings, title).markup;
                              })()}
                              onChange={e => setLinkGenManualMarkup(e.target.value)}
                              placeholder="0"
                              className="h-8 text-sm pl-6"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">{t('Shipping', 'Livraison')}</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              type="number"
                              step="1"
                              value={linkGenManualShipping || (() => {
                                const p = linkGenManualPrice ? parseFloat(linkGenManualPrice) : linkGenExtracted.price;
                                if (p <= 0) return '';
                                const title = linkGenManualTitle.trim() || linkGenExtracted?.title || '';
                                return calcProductTotals(p, feeSettings, title).shipping;
                              })()}
                              onChange={e => setLinkGenManualShipping(e.target.value)}
                              placeholder="0"
                              className="h-8 text-sm pl-6"
                            />
                          </div>
                        </div>
                      </div>
                      {(() => {
                        const p = linkGenManualPrice ? parseFloat(linkGenManualPrice) : linkGenExtracted.price;
                        if (p <= 0) return null;
                        const title = linkGenManualTitle.trim() || linkGenExtracted?.title || '';
                        const { markup: calcMarkup, shipping: calcShipping } = calcProductTotals(p, feeSettings, title);
                        const m = linkGenManualMarkup ? parseFloat(linkGenManualMarkup) : calcMarkup;
                        const s = linkGenManualShipping ? parseFloat(linkGenManualShipping) : calcShipping;
                        const finalOverrideVal = linkGenFinalOverride ? parseFloat(linkGenFinalOverride) : 0;
                        const total = finalOverrideVal > 0 ? finalOverrideVal : Math.ceil(p + m + s);
                        return (
                          <div className="flex items-center gap-3 pt-1">
                            <p className="text-sm font-bold text-primary">{t('Total:', 'Total :')} ${total}</p>
                            <div className="flex items-center gap-1">
                              <Label className="text-xs text-muted-foreground">{t('Override:', 'Remplacer :')}</Label>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                <Input
                                  type="number"
                                  step="1"
                                  value={linkGenFinalOverride}
                                  onChange={e => setLinkGenFinalOverride(e.target.value)}
                                  placeholder={String(total)}
                                  className="h-7 text-sm w-24 pl-6"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  {/* Description FR */}
                  <div>
                    <Label className="text-xs">{t('Description (FR) for WhatsApp', 'Description (FR) pour WhatsApp')}</Label>
                    <textarea
                      value={linkGenDescFr}
                      onChange={e => setLinkGenDescFr(e.target.value)}
                      placeholder={translatingFr ? t('Generating French description...', 'Génération de la description...') : t('French product description...', 'Description du produit en français...')}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                      rows={2}
                    />
                    {translatingFr && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {t('AI translating...', 'Traduction IA...')}</p>}
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
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-sm font-semibold text-muted-foreground">{t('Generated Links', 'Liens générés')} ({generatedLinks.length})</h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="ghost" size="sm" className="text-xs h-7" onClick={toggleSelectAllLinks}>
                        <CheckSquare className="h-3.5 w-3.5 mr-1" />
                        {selectedLinkIds.size === generatedLinks.length && generatedLinks.length > 0
                          ? t('Deselect All', 'Tout décocher')
                          : t('Select All', 'Tout cocher')}
                      </Button>
                      {selectedLinkIds.size > 0 && (
                        <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={bulkDeleting} onClick={bulkDeleteSelectedLinks}>
                          {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                          {t(`Delete (${selectedLinkIds.size})`, `Supprimer (${selectedLinkIds.size})`)}
                        </Button>
                      )}
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1"><GripVertical className="h-3 w-3" /> {t('Drag to reorder', 'Glisser pour réorganiser')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap p-2 border rounded-md bg-muted/30">
                    <Label className="text-xs font-medium">
                      {t('Global markup %', 'Marge globale %')}
                      {selectedLinkIds.size > 0
                        ? ` (${selectedLinkIds.size} ${t('selected', 'sélectionnés')})`
                        : ` (${t('all', 'tous')})`}
                    </Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={globalMarkupPct}
                        onChange={e => setGlobalMarkupPct(e.target.value)}
                        placeholder="15"
                        className="h-8 w-24 text-sm pr-6"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      onClick={applyGlobalMarkupToAll}
                      disabled={applyingGlobalMarkup || !globalMarkupPct || generatedLinks.length === 0}
                    >
                      {applyingGlobalMarkup ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                      {t('Apply to items', 'Appliquer aux articles')}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {t('Recomputes markup & total. Shipping unchanged.', 'Recalcule marge & total. Livraison inchangée.')}
                    </span>
                  </div>
                  <div className="hidden">{/* spacer */}</div>
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleLinksDragEnd}>
                    <SortableContext items={generatedLinks.map(l => l.id)} strategy={verticalListSortingStrategy}>
                      {generatedLinks.map(link => (
                        <SortableLinkRow key={link.id} id={link.id}>
                          <div className="p-3 border rounded-lg space-y-2 bg-card">
                      {editingLinkId === link.id ? (
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            {link.image_url && <img src={link.image_url} alt="" className="w-12 h-12 rounded object-cover shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <Label className="text-xs">{t('Title', 'Titre')}</Label>
                              <Input value={editLinkTitle} onChange={e => setEditLinkTitle(e.target.value)} className="h-8 text-sm" />
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <div>
                              <Label className="text-xs">{t('Item Price', 'Prix article')}</Label>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                <Input type="number" step="1" value={editLinkItemPrice} onChange={e => {
                                  setEditLinkItemPrice(e.target.value);
                                  const p = parseFloat(e.target.value) || 0;
                                  const m = parseFloat(editLinkMarkup) || 0;
                                  const s = parseFloat(editLinkShipping) || 0;
                                  setEditLinkFinalPrice(String(Math.ceil(p + m + s)));
                                }} className="h-8 text-sm pl-6" />
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs">{t('Markup', 'Marge')}</Label>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                <Input type="number" step="1" value={editLinkMarkup} onChange={e => {
                                  setEditLinkMarkup(e.target.value);
                                  const p = parseFloat(editLinkItemPrice) || 0;
                                  const m = parseFloat(e.target.value) || 0;
                                  const s = parseFloat(editLinkShipping) || 0;
                                  setEditLinkFinalPrice(String(Math.ceil(p + m + s)));
                                }} className="h-8 text-sm pl-6" />
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs">{t('Shipping', 'Livraison')}</Label>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                <Input type="number" step="1" value={editLinkShipping} onChange={e => {
                                  setEditLinkShipping(e.target.value);
                                  const p = parseFloat(editLinkItemPrice) || 0;
                                  const m = parseFloat(editLinkMarkup) || 0;
                                  const s = parseFloat(e.target.value) || 0;
                                  setEditLinkFinalPrice(String(Math.ceil(p + m + s)));
                                }} className="h-8 text-sm pl-6" />
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs font-bold">{t('Total', 'Total')}</Label>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                <Input type="number" step="1" value={editLinkFinalPrice} onChange={e => setEditLinkFinalPrice(e.target.value)} className="h-8 text-sm pl-6 font-bold" />
                              </div>
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">{t('Description (FR)', 'Description (FR)')}</Label>
                            <textarea
                              value={editLinkDescFr}
                              onChange={e => setEditLinkDescFr(e.target.value)}
                              placeholder={t('French description...', 'Description en français...')}
                              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[50px] resize-y"
                              rows={2}
                            />
                          </div>
                          {/* Gallery Images in edit mode */}
                          <div>
                            <Label className="text-xs flex items-center gap-1">{t('Images', 'Images')} ({editLinkGallery.length})</Label>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {editLinkGallery.map((img, i) => (
                                <div key={i} className="relative group">
                                  <img src={img} alt="" className="w-14 h-14 rounded border object-cover" />
                                  <button
                                    type="button"
                                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => setEditLinkGallery(prev => prev.filter((_, idx) => idx !== i))}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-1 mt-1">
                              <Input
                                value={newEditImageUrl}
                                onChange={e => setNewEditImageUrl(e.target.value)}
                                placeholder={t('Paste image URL or upload...', 'Collez une URL ou téléchargez...')}
                                className="h-7 text-xs flex-1"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2"
                                disabled={!newEditImageUrl.trim()}
                                onClick={() => {
                                  if (newEditImageUrl.trim()) {
                                    setEditLinkGallery(prev => [...prev, newEditImageUrl.trim()]);
                                    setNewEditImageUrl('');
                                  }
                                }}
                              >
                                <ImagePlus className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2"
                                disabled={uploadingImage}
                                onClick={() => {
                                  const input = document.createElement('input');
                                  input.type = 'file';
                                  input.accept = 'image/*';
                                  input.onchange = (e) => {
                                    const file = (e.target as HTMLInputElement).files?.[0];
                                    if (file) uploadProductImage(file, 'edit');
                                  };
                                  input.click();
                                }}
                              >
                                {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                              </Button>
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => setEditingLinkId(null)}>{t('Cancel', 'Annuler')}</Button>
                            <Button size="sm" onClick={() => saveEditLink(link.id)}>{t('Save', 'Enregistrer')}</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={selectedLinkIds.has(link.id)}
                              onCheckedChange={() => toggleLinkSelection(link.id)}
                              aria-label={t('Select product', 'Sélectionner le produit')}
                            />
                            {link.image_url && <img src={link.image_url} alt="" className="w-12 h-12 rounded object-cover shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{link.title}</p>
                              {link.description_fr && <p className="text-xs text-muted-foreground truncate">{link.description_fr}</p>}
                              <p className="text-xs text-muted-foreground">${link.total_price_usd.toFixed(0)} · {t('All inclusive', 'Tout inclus')}</p>
                              <p className="text-xs text-muted-foreground/70 truncate mt-0.5 font-mono">{getShareUrl(link.id)}</p>
                              {link.product_url && (
                                <a href={link.product_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 truncate mt-0.5 block">
                                  🔗 {t('Original link', 'Lien original')}
                                </a>
                              )}
                            </div>
                          <div className="flex gap-1.5 shrink-0 flex-wrap">
                            {/* Caption - shows preview then copy */}
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-1.5">
                                  <ClipboardCopy className="h-3.5 w-3.5" />
                                  <span className="hidden sm:inline">{t('Caption', 'Texte')}</span>
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-lg">
                                <DialogHeader>
                                  <DialogTitle>{t('Caption Preview', 'Aperçu du texte')}</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-3">
                                  {/* Price badge */}
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-lg font-bold text-primary">
                                      ${Math.ceil(link.total_price_usd)} <span className="text-xs font-normal text-muted-foreground">· {t('All inclusive', 'Tout inclus')} 🇨🇩</span>
                                    </div>
                                    {link.gallery_images.length > 0 && (
                                      <Badge variant="secondary" className="text-xs">{link.gallery_images.length} {t('images', 'images')}</Badge>
                                    )}
                                  </div>
                                  {/* Image gallery preview */}
                                  {link.gallery_images.length > 0 && (
                                    <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                                      {link.gallery_images.slice(0, 8).map((img, i) => (
                                        <div key={i} className="aspect-square rounded-md border border-border bg-white overflow-hidden">
                                          <img src={img} alt="" className="w-full h-full object-contain p-1" loading="lazy" />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* Caption text */}
                                  <pre className="whitespace-pre-wrap text-sm bg-muted p-3 rounded-md border max-h-60 overflow-y-auto font-sans">
                                    {buildCaption(link, getShareUrl(link.id))}
                                  </pre>
                                </div>
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => {
                                      navigator.clipboard.writeText(buildCaption(link, getShareUrl(link.id)));
                                      toast.success(t('Caption copied', 'Texte copié'));
                                    }}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    {t('Copy Caption', 'Copier le texte')}
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                            {/* Images - opens gallery dialog */}
                            {link.gallery_images.length > 0 && (
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm" className="gap-1.5">
                                    <ImageIcon className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">{t('Images', 'Images')}</span>
                                    <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">{link.gallery_images.length}</Badge>
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle className="text-sm">{t('Product Images — Click to copy', 'Images du produit — Cliquez pour copier')}</DialogTitle>
                                  </DialogHeader>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
                                    {link.gallery_images.map((img, i) => (
                                      <div
                                        key={i}
                                        className="relative group cursor-pointer rounded-lg overflow-hidden border border-border bg-white aspect-square"
                                        onClick={async () => {
                                          if (supportsClipboardImage()) {
                                            const ok = await copyImageToClipboard(img);
                                            if (ok) { toast.success(t('Image copied', 'Image copiée')); return; }
                                          }
                                          setImageFallbackModal({
                                            imageUrl: img,
                                            caption: buildCaption(link, getShareUrl(link.id)),
                                            title: link.title,
                                          });
                                        }}
                                      >
                                        <img src={img} alt="" className="w-full h-full object-contain p-2" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                          <div className="flex flex-col items-center gap-1 text-white">
                                            <Copy className="h-5 w-5" />
                                            <span className="text-xs font-medium">{t('Copy', 'Copier')}</span>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </DialogContent>
                              </Dialog>
                            )}
                            {/* Copy Link */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => {
                                navigator.clipboard.writeText(getShareUrl(link.id));
                                setCopiedLinkId(link.id);
                                setTimeout(() => setCopiedLinkId(null), 3000);
                                toast.success(t('Link copied!', 'Lien copié !'));
                              }}
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{t('Link', 'Lien')}</span>
                            </Button>
                            {/* More dropdown */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-1">
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => moveLinkGenProduct(link.id, -1)}
                                  disabled={generatedLinks[0]?.id === link.id}
                                >
                                  <ArrowUp className="h-3.5 w-3.5 mr-2" />
                                  {t('Move up', 'Monter')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => moveLinkGenProduct(link.id, 1)}
                                  disabled={generatedLinks[generatedLinks.length - 1]?.id === link.id}
                                >
                                  <ArrowDown className="h-3.5 w-3.5 mr-2" />
                                  {t('Move down', 'Descendre')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => startEditLink(link)}>
                                  <Pencil className="h-3.5 w-3.5 mr-2" />
                                  {t('Edit', 'Modifier')}
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onClick={() => deleteLinkGenProduct(link.id)}>
                                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                                  {t('Delete', 'Supprimer')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          </div>
                        </div>
                      )}
                          </div>
                        </SortableLinkRow>
                      ))}
                    </SortableContext>
                  </DndContext>
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
                            <p className="text-xs text-muted-foreground">${p.total_price_usd.toFixed(0)}</p>
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
                      <p className="text-xs text-muted-foreground">{catalogResult.provider} · ${catalogResult.price?.toFixed(0) || '0.00'}</p>
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
                        <p className="text-xs text-muted-foreground">{item.provider} · ${item.price.toFixed(0)}</p>
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

      {/* Image Fallback Modal */}
      <Dialog open={!!imageFallbackModal} onOpenChange={(open) => !open && setImageFallbackModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Save & Share Image', 'Enregistrer et partager l\'image')}</DialogTitle>
          </DialogHeader>
          {imageFallbackModal && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t(
                  'Image clipboard copy is not supported on this browser. Long-press (mobile) or right-click (desktop) the image to save it, then paste into WhatsApp.',
                  'La copie d\'image n\'est pas supportée sur ce navigateur. Appuyez longuement (mobile) ou clic droit (PC) sur l\'image pour l\'enregistrer, puis collez dans WhatsApp.'
                )}
              </p>
              <img
                src={imageFallbackModal.imageUrl}
                alt={imageFallbackModal.title}
                className="w-full max-h-[400px] object-contain rounded-lg border bg-white"
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    navigator.clipboard.writeText(imageFallbackModal.caption);
                    toast.success(t('Caption copied', 'Texte copié'));
                  }}
                >
                  <ClipboardCopy className="h-3.5 w-3.5" />
                  {t('Copy Caption', 'Copier le texte')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => downloadImage(imageFallbackModal.imageUrl, `${imageFallbackModal.title.slice(0, 30)}.jpg`)}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('Download Image', 'Télécharger l\'image')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '#';
  return escapeHtml(s);
}

function buildPreviewHtml(products: ShowcaseProduct[]): string {
  const productCells = products.map(p => {
    const safeTitle = escapeHtml(p.title.length > 45 ? p.title.slice(0, 45) + '…' : p.title);
    const safeImg = safeHttpUrl(p.image_url);
    const safeProductUrl = safeHttpUrl(p.product_url);
    const sep = String(p.product_url || '').includes('?') ? '&amp;' : '?';
    return `
    <td style="text-align:center;vertical-align:top;padding:8px;width:${Math.floor(100/Math.min(products.length, 3))}%;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
        ${p.image_url && safeImg !== '#' ? `<img src="${safeImg}" alt="${safeTitle}" style="width:100%;height:180px;object-fit:cover;display:block;" />` : ''}
        <div style="padding:10px;">
          <p style="font-weight:600;font-size:12px;margin:0 0 2px;color:#1a1a1a;line-height:1.3;">${safeTitle}</p>
          <p style="font-size:20px;font-weight:800;color:#e63946;margin:4px 0 2px;">$${Number(p.total_price_usd || 0).toFixed(0)}</p>
          <p style="font-size:9px;color:#666;margin:0 0 8px;">Tout inclus · All-inclusive</p>
          <a href="${safeProductUrl}${sep}hot=1" style="display:inline-block;background:#e63946;color:#fff;padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Commander</a>
        </div>
      </div>
    </td>
  `;
  }).join('');

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
