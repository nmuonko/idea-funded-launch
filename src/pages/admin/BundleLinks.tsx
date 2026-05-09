import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Package, Plus, Trash2, Copy, Share2, CalendarIcon, Search,
  Loader2, ExternalLink, Link as LinkIcon, ShoppingCart, X, Sparkles, Download
} from 'lucide-react';

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBundleItemsCsv(bundleTitle: string, items: BundleItem[]) {
  const header = ['title', 'price_usd', 'image_url', 'product_url', 'source_type', 'source_id'];
  const rows = items.map(i => [i.title, i.price_usd, i.image_url, i.product_url, i.source_type, i.source_id]);
  const csv = [header, ...rows].map(r => r.map(escapeCsvCell).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = bundleTitle.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'bundle';
  a.download = `${safe}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface BundleItem {
  id?: string;
  title: string;
  price_usd: number;
  image_url: string | null;
  product_url: string | null;
  source_type: string;
  source_id: string | null;
  sort_order: number;
}

interface Bundle {
  id: string;
  title: string;
  description: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  items: BundleItem[];
}

interface OrderItemRow {
  id: string;
  order_id: string;
  title: string;
  base_price_usd: number;
  unit_price_usd: number;
  product_image_url: string | null;
  product_url: string;
  quantity: number;
}

interface HotProductRow {
  id: string;
  title: string;
  total_price_usd: number;
  image_url: string | null;
  product_url: string | null;
}

export default function BundleLinks() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (en: string, fr: string) => language === 'fr' ? fr : en;

  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [suggestedTitles, setSuggestedTitles] = useState<string[]>([]);
  const [suggestingTitle, setSuggestingTitle] = useState(false);

  const handleSuggestTitle = async () => {
    if (!selectedItems.length) return;
    setSuggestingTitle(true);
    setSuggestedTitles([]);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const { data, error } = await supabase.functions.invoke('suggest-bundle-title', {
        body: { products: selectedItems.map(i => ({ title: i.title, price_usd: i.price_usd })) },
      });
      clearTimeout(timeout);
      if (error) throw error;
      if (data?.titles?.length) {
        setSuggestedTitles(data.titles.slice(0, 3));
      } else {
        toast.error(t('No suggestions available', 'Aucune suggestion disponible'));
      }
    } catch (e: any) {
      console.error('suggest-bundle-title error:', e);
      toast.error(t('Failed to get suggestions', 'Échec des suggestions'));
    } finally {
      setSuggestingTitle(false);
    }
  };
  const [description, setDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | undefined>();
  const [selectedItems, setSelectedItems] = useState<BundleItem[]>([]);

  // Source selection dialogs
  const [showOrderPicker, setShowOrderPicker] = useState(false);
  const [showHotProductPicker, setShowHotProductPicker] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [hotProducts, setHotProducts] = useState<HotProductRow[]>([]);
  const [loadingSource, setLoadingSource] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // CSV export dialog (multi-bundle)
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set());

  const exportKey = (bundleId: string, idx: number) => `${bundleId}::${idx}`;

  function openGlobalExport() {
    const all = new Set<string>();
    bundles.forEach(b => b.items.forEach((_, idx) => all.add(exportKey(b.id, idx))));
    setExportSelected(all);
    setExportOpen(true);
  }

  function toggleExportItem(bundleId: string, idx: number) {
    setExportSelected(prev => {
      const next = new Set(prev);
      const k = exportKey(bundleId, idx);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleBundleAll(bundle: Bundle) {
    const keys = bundle.items.map((_, idx) => exportKey(bundle.id, idx));
    const allSelected = keys.every(k => exportSelected.has(k));
    setExportSelected(prev => {
      const next = new Set(prev);
      if (allSelected) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
  }

  function confirmExportCsv() {
    const rows: { bundle: Bundle; item: BundleItem }[] = [];
    bundles.forEach(b => b.items.forEach((item, idx) => {
      if (exportSelected.has(exportKey(b.id, idx))) rows.push({ bundle: b, item });
    }));
    if (rows.length === 0) { toast.error(t('Select at least one product', 'Sélectionnez au moins un produit')); return; }
    const header = ['bundle_title', 'bundle_id', 'title', 'price_usd', 'image_url', 'product_url', 'source_type', 'source_id'];
    const data = rows.map(({ bundle, item }) => [bundle.title, bundle.id, item.title, item.price_usd, item.image_url, item.product_url, item.source_type, item.source_id]);
    const csv = [header, ...data].map(r => r.map(escapeCsvCell).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bundle-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('CSV downloaded', 'CSV téléchargé'));
    setExportOpen(false);
  }

  const loadBundles = useCallback(async () => {
    const { data: bundlesData } = await supabase
      .from('product_bundles')
      .select('*')
      .order('created_at', { ascending: false });

    if (!bundlesData) { setLoading(false); return; }

    const bundlesWithItems: Bundle[] = [];
    for (const b of bundlesData) {
      const { data: items } = await supabase
        .from('product_bundle_items')
        .select('*')
        .eq('bundle_id', b.id)
        .order('sort_order', { ascending: true });

      bundlesWithItems.push({
        ...b,
        items: (items || []).map(i => ({
          id: i.id,
          title: i.title,
          price_usd: Number(i.price_usd),
          image_url: i.image_url,
          product_url: i.product_url,
          source_type: i.source_type,
          source_id: i.source_id,
          sort_order: i.sort_order,
        })),
      });
    }
    setBundles(bundlesWithItems);
    setLoading(false);
  }, []);

  useEffect(() => { loadBundles(); }, [loadBundles]);

  async function searchOrderItems() {
    setLoadingSource(true);
    let query = supabase
      .from('order_items')
      .select('id, order_id, title, base_price_usd, unit_price_usd, product_image_url, product_url, quantity')
      .order('created_at', { ascending: false })
      .limit(50);

    if (orderSearch.trim()) {
      query = query.ilike('title', `%${orderSearch.trim()}%`);
    }

    const { data } = await query;
    setOrderItems((data || []) as OrderItemRow[]);
    setLoadingSource(false);
  }

  async function loadHotProducts() {
    setLoadingSource(true);
    const { data } = await (supabase
      .from('hot_products_showcase')
      .select('id, title, total_price_usd, image_url, product_url') as any)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50);
    setHotProducts((data || []) as HotProductRow[]);
    setLoadingSource(false);
  }

  function addItemFromOrder(item: OrderItemRow) {
    const already = selectedItems.some(s => s.source_id === item.id && s.source_type === 'order_item');
    if (already) { toast.info(t('Already added', 'Déjà ajouté')); return; }
    setSelectedItems(prev => [...prev, {
      title: item.title || 'Product',
      price_usd: item.unit_price_usd || item.base_price_usd,
      image_url: item.product_image_url,
      product_url: item.product_url,
      source_type: 'order_item',
      source_id: item.id,
      sort_order: prev.length,
    }]);
    toast.success(t('Added', 'Ajouté'));
  }

  function addItemFromHotProduct(item: HotProductRow) {
    const already = selectedItems.some(s => s.source_id === item.id && s.source_type === 'hot_product');
    if (already) { toast.info(t('Already added', 'Déjà ajouté')); return; }
    setSelectedItems(prev => [...prev, {
      title: item.title || 'Product',
      price_usd: item.total_price_usd,
      image_url: item.image_url,
      product_url: item.product_url,
      source_type: 'hot_product',
      source_id: item.id,
      sort_order: prev.length,
    }]);
    toast.success(t('Added', 'Ajouté'));
  }

  function removeSelectedItem(idx: number) {
    setSelectedItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function createBundle() {
    if (!title.trim()) { toast.error(t('Title required', 'Titre requis')); return; }
    if (selectedItems.length === 0) { toast.error(t('Add at least one product', 'Ajoutez au moins un produit')); return; }
    if (!user) return;

    setCreating(true);
    try {
      const { data: bundle, error } = await supabase
        .from('product_bundles')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          created_by: user.id,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
        })
        .select('id')
        .single();

      if (error || !bundle) throw error || new Error('Failed');

      const itemsToInsert = selectedItems.map((item, idx) => ({
        bundle_id: bundle.id,
        title: item.title,
        price_usd: item.price_usd,
        image_url: item.image_url,
        product_url: item.product_url,
        source_type: item.source_type,
        source_id: item.source_id,
        sort_order: idx,
      }));

      const { error: itemsError } = await supabase.from('product_bundle_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;

      const url = `${window.location.origin}/bundle/${bundle.id}`;
      await navigator.clipboard.writeText(url);
      toast.success(t('Bundle created & link copied!', 'Pack créé et lien copié !'));

      setShowCreate(false);
      setTitle('');
      setDescription('');
      setExpiresAt(undefined);
      setSelectedItems([]);
      loadBundles();
    } catch (e: any) {
      console.error('createBundle error:', e);
      toast.error(e?.message || t('Failed to create bundle', 'Échec de la création'));
    }
    setCreating(false);
  }

  async function deleteBundle(id: string) {
    await supabase.from('product_bundles').delete().eq('id', id);
    setBundles(prev => prev.filter(b => b.id !== id));
    toast.success(t('Deleted', 'Supprimé'));
  }

  async function toggleBundleActive(id: string, current: boolean) {
    await supabase.from('product_bundles').update({ is_active: !current }).eq('id', id);
    setBundles(prev => prev.map(b => b.id === id ? { ...b, is_active: !current } : b));
  }

  function copyBundleLink(id: string) {
    const url = `${window.location.origin}/bundle/${id}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(t('Link copied!', 'Lien copié !'));
  }

  function shareBundleWhatsApp(bundle: Bundle) {
    const url = `${window.location.origin}/bundle/${bundle.id}`;
    const total = bundle.items.reduce((s, i) => s + i.price_usd, 0);
    const msg = `🛍️ ${bundle.title}\n${bundle.items.length} ${t('products', 'produits')} - $${total}\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const totalSelected = selectedItems.reduce((s, i) => s + i.price_usd, 0);

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" />
            {t('Bundle Links', 'Liens de Pack')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('Create shareable product bundles for customers', 'Créez des packs de produits partageables pour les clients')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openGlobalExport} className="gap-2">
            <Download className="w-4 h-4" /> {t('Export CSV', 'Exporter CSV')}
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> {t('New Bundle', 'Nouveau Pack')}
          </Button>
        </div>
      </div>

      {/* Create Bundle Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Create Product Bundle', 'Créer un Pack Produits')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('Bundle Title', 'Titre du Pack')}</Label>
              <div className="flex gap-2">
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('e.g. Electronics Starter Pack', 'ex. Pack Électronique')} className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectedItems.length === 0 || suggestingTitle}
                  onClick={handleSuggestTitle}
                  className="gap-1 shrink-0"
                >
                  {suggestingTitle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  AI
                </Button>
              </div>
              {suggestedTitles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {suggestedTitles.map((s, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => { setTitle(s); setSuggestedTitles([]); }}
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>{t('Description (optional)', 'Description (optionnel)')}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>{t('Expiration Date (optional)', 'Date d\'expiration (optionnel)')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left", !expiresAt && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expiresAt ? format(expiresAt, 'PPP') : t('No expiration', 'Pas d\'expiration')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={expiresAt} onSelect={setExpiresAt} disabled={(d) => d < new Date()} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              {expiresAt && <Button variant="ghost" size="sm" onClick={() => setExpiresAt(undefined)} className="mt-1 text-xs">{t('Clear', 'Effacer')}</Button>}
            </div>

            {/* Add items section */}
            <div>
              <Label className="mb-2 block">{t('Products', 'Produits')} ({selectedItems.length})</Label>
              <div className="flex gap-2 mb-3">
                <Button variant="outline" size="sm" onClick={() => { setShowOrderPicker(true); searchOrderItems(); }} className="gap-1">
                  <ShoppingCart className="w-3 h-3" /> {t('From Orders', 'Depuis Commandes')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setShowHotProductPicker(true); loadHotProducts(); }} className="gap-1">
                  <LinkIcon className="w-3 h-3" /> {t('From Generated Links', 'Depuis Liens Générés')}
                </Button>
              </div>

              {selectedItems.length > 0 && (
                <div className="space-y-2 mb-3">
                  {selectedItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-2 border rounded-md bg-muted/30">
                      {item.image_url && <img src={item.image_url} alt="" className="w-10 h-10 rounded object-cover" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">${item.price_usd}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {item.source_type === 'order_item' ? t('Order', 'Commande') : t('Link', 'Lien')}
                      </Badge>
                      <Button variant="ghost" size="icon" onClick={() => removeSelectedItem(idx)} className="shrink-0">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <p className="text-sm font-semibold text-right">
                    {t('Total', 'Total')}: ${totalSelected.toFixed(2)}
                  </p>
                </div>
              )}
            </div>

            <Button onClick={createBundle} disabled={creating} className="w-full gap-2">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              {t('Create Bundle & Copy Link', 'Créer le Pack & Copier le Lien')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Items Picker */}
      <Dialog open={showOrderPicker} onOpenChange={setShowOrderPicker}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t('Select from Orders', 'Sélectionner depuis les Commandes')}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 mb-3">
            <Input placeholder={t('Search by title...', 'Rechercher par titre...')} value={orderSearch} onChange={e => setOrderSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchOrderItems()} />
            <Button variant="outline" onClick={searchOrderItems} size="icon"><Search className="w-4 h-4" /></Button>
          </div>
          <ScrollArea className="max-h-[50vh]">
            {loadingSource ? (
              <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : orderItems.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground p-4">{t('No items found', 'Aucun article trouvé')}</p>
            ) : (
              <div className="space-y-2">
                {orderItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2 border rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => addItemFromOrder(item)}>
                    {item.product_image_url && <img src={item.product_image_url} alt="" className="w-10 h-10 rounded object-cover" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title || 'Product'}</p>
                      <p className="text-xs text-muted-foreground">${item.unit_price_usd || item.base_price_usd} · Qty: {item.quantity}</p>
                    </div>
                    <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Hot Products Picker */}
      <Dialog open={showHotProductPicker} onOpenChange={setShowHotProductPicker}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t('Select from Generated Links', 'Sélectionner depuis les Liens Générés')}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {loadingSource ? (
              <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : hotProducts.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground p-4">{t('No products found', 'Aucun produit trouvé')}</p>
            ) : (
              <div className="space-y-2">
                {hotProducts.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2 border rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => addItemFromHotProduct(item)}>
                    {item.image_url && <img src={item.image_url} alt="" className="w-10 h-10 rounded object-cover" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title || 'Product'}</p>
                      <p className="text-xs text-muted-foreground">${item.total_price_usd}</p>
                    </div>
                    <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* CSV Export Dialog */}
      <Dialog open={!!exportBundle} onOpenChange={(open) => !open && setExportBundle(null)}>
        <DialogContent className="max-w-lg max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{t('Export Products to CSV', 'Exporter les Produits en CSV')}</DialogTitle>
          </DialogHeader>
          {exportBundle && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {exportSelected.size} / {exportBundle.items.length} {t('selected', 'sélectionnés')}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setExportSelected(new Set(exportBundle.items.map((_, i) => String(i))))}>
                    {t('Select all', 'Tout sélectionner')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setExportSelected(new Set())}>
                    {t('Clear', 'Effacer')}
                  </Button>
                </div>
              </div>
              <ScrollArea className="max-h-[50vh] pr-2">
                <div className="space-y-2">
                  {exportBundle.items.map((item, idx) => {
                    const checked = exportSelected.has(String(idx));
                    return (
                      <label key={idx} className="flex items-center gap-3 p-2 border rounded-md cursor-pointer hover:bg-muted/40">
                        <Checkbox checked={checked} onCheckedChange={() => toggleExportItem(idx)} />
                        {item.image_url && <img src={item.image_url} alt="" className="w-10 h-10 rounded object-cover" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-xs text-muted-foreground">${item.price_usd}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
              <Button onClick={confirmExportCsv} className="w-full gap-2">
                <Download className="w-4 h-4" /> {t('Download CSV', 'Télécharger le CSV')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bundles List */}
      {bundles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Package className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg">{t('No bundles yet', 'Pas encore de packs')}</h3>
            <p className="text-sm text-muted-foreground mt-1">{t('Create your first product bundle to share with customers', 'Créez votre premier pack produits à partager avec les clients')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {bundles.map(bundle => {
            const total = bundle.items.reduce((s, i) => s + i.price_usd, 0);
            const expired = bundle.expires_at && new Date(bundle.expires_at) < new Date();
            return (
              <Card key={bundle.id} className={cn(!bundle.is_active && 'opacity-60')}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {bundle.title}
                        {expired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                        {!bundle.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      </CardTitle>
                      {bundle.description && <p className="text-sm text-muted-foreground mt-1">{bundle.description}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{bundle.items.length} {t('products', 'produits')}</span>
                        <span>•</span>
                        <span>${total.toFixed(2)} {t('total', 'total')}</span>
                        {bundle.expires_at && (
                          <>
                            <span>•</span>
                            <span>{t('Expires', 'Expire')} {format(new Date(bundle.expires_at), 'PP')}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => copyBundleLink(bundle.id)} className="gap-1">
                        <Copy className="w-3 h-3" />
                        {copiedId === bundle.id ? t('Copied!', 'Copié !') : t('Copy Link', 'Copier')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openExportDialog(bundle)} className="gap-1">
                        <Download className="w-3 h-3" /> CSV
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => shareBundleWhatsApp(bundle)} className="gap-1">
                        <Share2 className="w-3 h-3" /> WhatsApp
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleBundleActive(bundle.id, bundle.is_active)}>
                        {bundle.is_active ? t('Deactivate', 'Désactiver') : t('Activate', 'Activer')}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteBundle(bundle.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {bundle.items.map((item, idx) => (
                      <div key={idx} className="flex-shrink-0 w-28">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="w-28 h-28 rounded-md object-cover" />
                        ) : (
                          <div className="w-28 h-28 rounded-md bg-muted flex items-center justify-center">
                            <Package className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                        <p className="text-xs mt-1 truncate">{item.title}</p>
                        <p className="text-xs font-semibold">${item.price_usd}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
