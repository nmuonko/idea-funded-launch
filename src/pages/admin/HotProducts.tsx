import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, Plus, Trash2, Send, Save, Eye, Loader2, Mail, Link2, Edit2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { calculateShippingUsd } from '@/lib/shippingCalculation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';

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

interface SelectedProduct {
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
}

interface FeeSettings {
  markupPercent: number;
  vehicleMarkupPercent: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
}

interface Campaign {
  id: string;
  title: string;
  status: string;
  products: SelectedProduct[];
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
}

/** Upgrade image URL to highest resolution */
function toHighResImage(url: string): string {
  if (!url) return url;
  // Amazon: replace size tokens with full-res
  if (url.includes('amazon.com') || url.includes('media-amazon.com')) {
    return url
      .replace(/\._[A-Z]{2}_[A-Z0-9_]+_\./, '._SL1500_.')
      .replace(/\._S[SXLY]\d+_\./, '._SL1500_.')
      .replace(/\._AC_[A-Z0-9_]+_\./, '._SL1500_.');
  }
  // eBay: use full size
  if (url.includes('ebayimg.com')) {
    return url.replace(/\/s-l\d+\./, '/s-l1600.');
  }
  return url;
}

function calcProductTotals(basePrice: number, fees: FeeSettings): { markup: number; shipping: number; total: number } {
  const markup = basePrice * (fees.markupPercent / 100);
  const shipping = calculateShippingUsd(basePrice, fees.shippingBaseFeeUsd, fees.shippingPercent);
  return { markup, shipping, total: Math.round((basePrice + markup + shipping) * 100) / 100 };
}

export default function HotProducts() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [campaignTitle, setCampaignTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [feeSettings, setFeeSettings] = useState<FeeSettings>({ markupPercent: 15, vehicleMarkupPercent: 15, shippingBaseFeeUsd: 20, shippingPercent: 10 });
  const [pasteUrl, setPasteUrl] = useState('');
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    loadCampaigns();
    loadFeeSettings();
  }, []);

  async function loadFeeSettings() {
    const { data } = await supabase.from('settings' as any).select('markup_percent, shipping_base_fee_usd, shipping_percent, category_markups').limit(1).single();
    if (data) {
      const d = data as any;
      setFeeSettings({
        markupPercent: d.markup_percent ?? 15,
        vehicleMarkupPercent: (d.category_markups as any)?.vehicles ?? d.markup_percent ?? 15,
        shippingBaseFeeUsd: d.shipping_base_fee_usd ?? 20,
        shippingPercent: d.shipping_percent ?? 10,
      });
    }
  }

  async function loadCampaigns() {
    setLoading(true);
    const { data } = await supabase
      .from('hot_product_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) {
      setCampaigns(data.map(c => ({ ...c, products: (c.products as any) || [] })));
    }
    setLoading(false);
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
    // Try to get highest quality image from images array or image_url
    const images = item.images as any;
    let candidates: string[] = [];
    if (Array.isArray(images)) {
      candidates = images.filter((u: string) => typeof u === 'string');
    } else if (images && typeof images === 'object') {
      candidates = Object.values(images).flat().filter((u: any) => typeof u === 'string') as string[];
    }
    candidates = [item.image_url, ...candidates].filter(Boolean);
    // Pick first and upgrade to high-res
    return toHighResImage(candidates[0] || '');
  }

  function addProduct(item: any) {
    if (selectedProducts.length >= 10) { toast.error('Maximum 10 products'); return; }
    if (selectedProducts.find(p => p.id === item.id)) { toast.error('Already added'); return; }
    const basePrice = item.price_usd || 0;
    const { markup, shipping, total } = calcProductTotals(basePrice, feeSettings);
    setSelectedProducts(prev => [...prev, {
      id: item.id,
      title: item.title || 'Untitled',
      image_url: getBestImage(item),
      price_usd: basePrice,
      markup_usd: Math.round(markup * 100) / 100,
      shipping_usd: Math.round(shipping * 100) / 100,
      total_price_usd: total,
      product_url: `https://afrishop-usa.com/product/${item.provider}/${item.provider_product_id}`,
      provider: item.provider || '',
      provider_product_id: item.provider_product_id || '',
    }]);
  }

  async function extractFromLink() {
    if (!pasteUrl.trim()) return;
    if (selectedProducts.length >= 10) { toast.error('Maximum 10 products'); return; }
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('extract-price', {
        body: { url: pasteUrl.trim(), forceRefresh: true },
      });
      if (error || !data) {
        toast.error('Failed to extract product info');
        setExtracting(false);
        return;
      }
      const basePrice = data.basePrice || data.price || data.priceUsd || 0;
      const imageUrl = toHighResImage(data.imageUrl || data.image || '');
      const title = data.title || data.name || 'Product';
      const { markup, shipping, total } = calcProductTotals(basePrice, feeSettings);

      setSelectedProducts(prev => [...prev, {
        id: `paste-${Date.now()}`,
        title,
        image_url: imageUrl,
        price_usd: basePrice,
        markup_usd: Math.round(markup * 100) / 100,
        shipping_usd: Math.round(shipping * 100) / 100,
        total_price_usd: total,
        product_url: (() => {
          const prov = data.provider || inferProvider(pasteUrl.trim());
          const pid = data.providerId || inferProductId(pasteUrl.trim());
          return (prov && pid) ? `https://afrishop-usa.com/product/${prov}/${pid}` : `https://afrishop-usa.com/paste-link`;
        })(),
        provider: data.provider || inferProvider(pasteUrl.trim()) || 'external',
        provider_product_id: data.providerId || inferProductId(pasteUrl.trim()) || '',
      }]);
      setPasteUrl('');
      toast.success('Product extracted!');
    } catch {
      toast.error('Extraction failed');
    }
    setExtracting(false);
  }

  function removeProduct(id: string) {
    setSelectedProducts(prev => prev.filter(p => p.id !== id));
  }

  function updateTitle(id: string, title: string) {
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, title } : p));
  }

  function updateShipping(id: string, shipping: number) {
    setSelectedProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const newTotal = Math.round((p.price_usd + p.markup_usd + shipping) * 100) / 100;
      return { ...p, shipping_usd: shipping, total_price_usd: newTotal };
    }));
  }

  function updateTotalPrice(id: string, total: number) {
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, total_price_usd: total } : p));
  }

  async function saveDraft() {
    if (!campaignTitle.trim()) { toast.error('Enter a campaign title'); return; }
    if (selectedProducts.length === 0) { toast.error('Add at least 1 product'); return; }
    setSaving(true);
    // Refresh session to avoid stale tokens
    await supabase.auth.refreshSession();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) { toast.error('Session expired – please sign in again'); setSaving(false); return; }
    const payload = { title: campaignTitle, status: 'draft', products: selectedProducts as any, created_by: currentUser.id, updated_at: new Date().toISOString() };
    let error;
    if (editingCampaignId) {
      ({ error } = await supabase.from('hot_product_campaigns').update(payload).eq('id', editingCampaignId));
    } else {
      ({ error } = await supabase.from('hot_product_campaigns').insert(payload));
    }
    if (error) toast.error('Failed: ' + error.message);
    else { toast.success('Draft saved'); resetForm(); loadCampaigns(); }
    setSaving(false);
  }

  async function approveAndSend(campaignId: string) {
    setSending(true);
    await supabase.from('hot_product_campaigns').update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() }).eq('id', campaignId);
    const { data, error } = await supabase.functions.invoke('send-hot-products-email', { body: { campaignId } });
    if (error) toast.error('Failed: ' + error.message);
    else toast.success(`Sent! ${(data as any)?.sent || 0} emails delivered.`);
    loadCampaigns();
    setSending(false);
  }

  function editCampaign(c: Campaign) { setEditingCampaignId(c.id); setCampaignTitle(c.title); setSelectedProducts(c.products); }
  function resetForm() { setEditingCampaignId(null); setCampaignTitle(''); setSelectedProducts([]); setSearchQuery(''); setSearchResults([]); setPasteUrl(''); }

  const statusColor: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800', approved: 'bg-blue-100 text-blue-800',
    sending: 'bg-orange-100 text-orange-800', sent: 'bg-green-100 text-green-800',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{language === 'fr' ? 'Produits Vedettes' : 'Hot Products'}</h1>
        <p className="text-sm text-muted-foreground">
          {language === 'fr' ? 'Campagnes email – prix auto-calculé (base + marge + livraison)' : 'Email campaigns – auto-calculated pricing (base + markup + shipping)'}
        </p>
      </div>

      {/* Campaign Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {editingCampaignId ? (language === 'fr' ? 'Modifier' : 'Edit Campaign') : (language === 'fr' ? 'Nouvelle Campagne' : 'New Campaign')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder={language === 'fr' ? 'Titre (ex: Semaine du 12 mars)' : 'Title (e.g. Week of March 12)'}
            value={campaignTitle}
            onChange={e => setCampaignTitle(e.target.value)}
          />

          {/* Product Add Methods */}
          <Tabs defaultValue="catalog" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="catalog"><Search className="h-3.5 w-3.5 mr-1.5" />{language === 'fr' ? 'Catalogue' : 'Catalog'}</TabsTrigger>
              <TabsTrigger value="paste"><Link2 className="h-3.5 w-3.5 mr-1.5" />{language === 'fr' ? 'Coller un lien' : 'Paste Link'}</TabsTrigger>
            </TabsList>

            <TabsContent value="catalog" className="space-y-2 mt-3">
              <div className="flex gap-2">
                <Input placeholder={language === 'fr' ? 'Rechercher...' : 'Search products...'} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchProducts()} />
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
              <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Collez un lien Amazon, Walmart, SHEIN, etc.' : 'Paste a link from Amazon, Walmart, SHEIN, etc.'}</p>
              <div className="flex gap-2">
                <Input placeholder="https://www.amazon.com/dp/..." value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && extractFromLink()} />
                <Button onClick={extractFromLink} disabled={extracting} size="sm">
                  {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* Selected Products with price breakdown */}
          {selectedProducts.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{language === 'fr' ? 'Produits' : 'Products'} ({selectedProducts.length}/10)</p>
              {selectedProducts.map(p => (
                <div key={p.id} className="p-3 border rounded-lg space-y-2">
                  <div className="flex items-start gap-3">
                    {p.image_url && <img src={p.image_url} alt="" className="w-16 h-16 rounded object-cover shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <Input 
                        value={p.title} 
                        onChange={e => updateTitle(p.id, e.target.value)} 
                        className="text-sm font-medium h-7 mb-1" 
                        placeholder="Product title"
                      />
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        <span>{language === 'fr' ? 'Prix de base' : 'Base'}:</span>
                        <span className="font-medium text-foreground">${p.price_usd.toFixed(2)}</span>
                        <span>{language === 'fr' ? 'Marge' : 'Markup'} ({feeSettings.markupPercent}%):</span>
                        <span className="font-medium text-foreground">${p.markup_usd.toFixed(2)}</span>
                        <span className="flex items-center gap-1">
                          {language === 'fr' ? 'Livraison' : 'Shipping'}:
                          <Edit2 className="h-3 w-3 text-primary" />
                        </span>
                        <Input type="number" className="h-5 w-20 text-xs px-1" value={p.shipping_usd} onChange={e => updateShipping(p.id, parseFloat(e.target.value) || 0)} />
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeProduct(p.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between bg-muted/50 rounded px-3 py-1.5">
                    <span className="text-sm font-semibold">{language === 'fr' ? 'Prix total affiché' : 'Displayed total'}:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-primary">${p.total_price_usd.toFixed(2)}</span>
                      <Input type="number" className="h-7 w-24 text-sm" value={p.total_price_usd} onChange={e => updateTotalPrice(p.id, parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={saveDraft} disabled={saving} variant="outline">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {language === 'fr' ? 'Brouillon' : 'Save Draft'}
            </Button>
            {selectedProducts.length > 0 && (
              <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline"><Eye className="h-4 w-4 mr-2" />{language === 'fr' ? 'Aperçu' : 'Preview'}</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>{language === 'fr' ? 'Aperçu Email' : 'Email Preview'}</DialogTitle></DialogHeader>
                  <div className="border rounded-lg p-4" dangerouslySetInnerHTML={{ __html: buildPreviewHtml(selectedProducts) }} />
                </DialogContent>
              </Dialog>
            )}
            {editingCampaignId && <Button variant="ghost" onClick={resetForm}>{language === 'fr' ? 'Annuler' : 'Cancel'}</Button>}
          </div>
        </CardContent>
      </Card>

      {/* Campaign History */}
      <Card>
        <CardHeader><CardTitle className="text-lg">{language === 'fr' ? 'Historique' : 'Campaign History'}</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{language === 'fr' ? 'Aucune campagne' : 'No campaigns yet'}</p>
          ) : (
            <div className="space-y-3">
              {campaigns.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{c.title || 'Untitled'}</p>
                      <Badge className={statusColor[c.status] || ''}>{c.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.products.length} {language === 'fr' ? 'produits' : 'products'}
                      {c.status === 'sent' && ` • ${c.sent_count} sent, ${c.failed_count} failed`}
                      {' • '}{new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {c.status === 'draft' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => editCampaign(c)}>{language === 'fr' ? 'Modifier' : 'Edit'}</Button>
                        <Button size="sm" onClick={() => approveAndSend(c.id)} disabled={sending}>
                          {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                          {language === 'fr' ? 'Envoyer' : 'Send'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function buildPreviewHtml(products: SelectedProduct[]): string {
  const productCells = products.map(p => `
    <td style="text-align:center;vertical-align:top;padding:8px;width:${Math.floor(100/products.length)}%;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}" style="width:100%;height:180px;object-fit:cover;display:block;" />` : ''}
        <div style="padding:10px;">
          <p style="font-weight:600;font-size:12px;margin:0 0 2px;color:#1a1a1a;line-height:1.3;">${p.title.length > 45 ? p.title.slice(0, 45) + '…' : p.title}</p>
          <p style="font-size:20px;font-weight:800;color:#e63946;margin:4px 0 2px;">$${p.total_price_usd.toFixed(2)}</p>
          <p style="font-size:9px;color:#666;margin:0 0 8px;">Tout inclus · All-inclusive</p>
          <a href="${p.product_url}" style="display:inline-block;background:#e63946;color:#fff;padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Commander</a>
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
        <p style="font-size:12px;color:#555;margin:16px 0 4px;line-height:1.5;">Vous cherchez un autre produit ? Visitez <a href="https://afrishop-usa.com/paste-link" style="color:#e63946;text-decoration:underline;">afrishop-usa.com</a> et collez le lien de n'importe quel produit américain.</p>
        <p style="font-size:11px;color:#888;margin:0;line-height:1.5;">Looking for something else? Visit <a href="https://afrishop-usa.com/paste-link" style="color:#e63946;text-decoration:underline;">afrishop-usa.com</a> and paste any US product link.</p>
      </div>
      <div style="text-align:center;padding:12px;background:#f3f4f6;font-size:10px;color:#999;">
        <p style="margin:2px 0;">AfriShop USA - Achetez aux USA, livré en Afrique</p>
        <p style="margin:2px 0;">&copy; ${new Date().getFullYear()} AfriShop USA</p>
      </div>
    </div>
  `;
}
