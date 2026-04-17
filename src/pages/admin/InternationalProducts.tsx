import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Trash2, Save, Globe, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface CountryRow {
  country: string;
  label_en: string;
  label_fr: string;
  flag_emoji: string;
  rate_per_kg_usd: number;
  enabled: boolean;
}

interface IntlProduct {
  id: string;
  country: string;
  title: string;
  image_url: string;
  product_url: string;
  base_price_usd: number;
  est_weight_kg: number;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

const COUNTRY_FILTER_OPTIONS = ['all', 'china', 'dubai', 'turkey'];

export default function InternationalProducts() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isFr = language === 'fr';
  const t = (en: string, fr: string) => (isFr ? fr : en);

  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [globalMarkupPercent, setGlobalMarkupPercent] = useState<number>(15);
  const [products, setProducts] = useState<IntlProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCountry, setFilterCountry] = useState<string>('all');

  // Add form
  const [form, setForm] = useState({
    country: 'china',
    title: '',
    image_url: '',
    product_url: '',
    base_price_usd: '',
    est_weight_kg: '1',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<IntlProduct>>({});

  const loadAll = async () => {
    setLoading(true);
    const [countriesRes, settingsRes, productsRes] = await Promise.all([
      (supabase.from('country_shipping_rates' as any)
        .select('*')
        .neq('country', 'usa')
        .order('sort_order', { ascending: true })) as any,
      supabase.from('settings' as any).select('markup_percent').limit(1).single() as any,
      (supabase.from('international_products' as any)
        .select('*')
        .order('created_at', { ascending: false })) as any,
    ]);
    if (countriesRes.data) setCountries(countriesRes.data as CountryRow[]);
    if (settingsRes.data) {
      const m = (settingsRes.data as any).markup_percent;
      if (m != null) setGlobalMarkupPercent(Number(m));
    }
    if (Array.isArray(productsRes.data)) setProducts(productsRes.data as IntlProduct[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const markupRate = globalMarkupPercent > 1 ? globalMarkupPercent / 100 : globalMarkupPercent;

  const computeTotal = (basePrice: number, weightKg: number, country: string): number => {
    const c = countries.find((x) => x.country === country);
    const rate = Number(c?.rate_per_kg_usd) || 0;
    const markup = basePrice * markupRate;
    const shipping = weightKg * rate;
    return Math.ceil(basePrice + markup + shipping);
  };

  const previewTotal = useMemo(() => {
    const bp = Number(form.base_price_usd) || 0;
    const w = Number(form.est_weight_kg) || 0;
    if (bp <= 0) return null;
    return computeTotal(bp, w, form.country);
  }, [form, countries, globalMarkupPercent]);

  const filteredProducts = useMemo(() => {
    if (filterCountry === 'all') return products;
    return products.filter((p) => p.country === filterCountry);
  }, [products, filterCountry]);

  const handleAdd = async () => {
    const bp = Number(form.base_price_usd);
    const w = Number(form.est_weight_kg);
    if (!form.title.trim() || !form.image_url.trim() || !form.product_url.trim() || !(bp > 0) || !(w >= 0)) {
      toast.error(t('Fill all required fields', 'Remplissez tous les champs requis'));
      return;
    }
    setSaving(true);
    const { error } = await (supabase.from('international_products' as any).insert({
      country: form.country,
      title: form.title.trim(),
      image_url: form.image_url.trim(),
      product_url: form.product_url.trim(),
      base_price_usd: bp,
      est_weight_kg: w,
      description: form.description.trim() || null,
      sort_order: 0,
      is_active: true,
      created_by: user?.id || null,
    }) as any);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('Product added', 'Produit ajouté'));
    setForm({ country: form.country, title: '', image_url: '', product_url: '', base_price_usd: '', est_weight_kg: '1', description: '' });
    loadAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('Delete this product?', 'Supprimer ce produit ?'))) return;
    const { error } = await (supabase.from('international_products' as any).delete().eq('id', id) as any);
    if (error) { toast.error(error.message); return; }
    toast.success(t('Deleted', 'Supprimé'));
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleToggleActive = async (p: IntlProduct) => {
    const { error } = await (supabase.from('international_products' as any)
      .update({ is_active: !p.is_active })
      .eq('id', p.id) as any);
    if (error) { toast.error(error.message); return; }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)));
  };

  const startEdit = (p: IntlProduct) => {
    setEditingId(p.id);
    setEditDraft({ ...p });
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft) return;
    const bp = Number(editDraft.base_price_usd);
    const w = Number(editDraft.est_weight_kg);
    if (!editDraft.title || !editDraft.image_url || !editDraft.product_url || !(bp > 0)) {
      toast.error(t('Invalid fields', 'Champs invalides'));
      return;
    }
    const { error } = await (supabase.from('international_products' as any).update({
      country: editDraft.country,
      title: editDraft.title,
      image_url: editDraft.image_url,
      product_url: editDraft.product_url,
      base_price_usd: bp,
      est_weight_kg: w,
      description: editDraft.description || null,
      sort_order: editDraft.sort_order ?? 0,
    }).eq('id', editingId) as any);
    if (error) { toast.error(error.message); return; }
    toast.success(t('Saved', 'Enregistré'));
    setEditingId(null);
    setEditDraft({});
    loadAll();
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" />
            {t('International Products', 'Produits Internationaux')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t(
              'Manually add products from China, Dubai, and Turkey. Pricing uses the global markup + per-country per-kg shipping.',
              'Ajoutez manuellement des produits de Chine, Dubaï et Turquie. Tarification = marge globale + expédition par kg par pays.',
            )}
          </p>
        </div>
        <Button variant="outline" onClick={loadAll} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {t('Refresh', 'Actualiser')}
        </Button>
      </div>

      {/* Add new product */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {t('Add new product', 'Ajouter un produit')}
          </CardTitle>
          <CardDescription>
            {t('Markup', 'Marge')}: <strong>{globalMarkupPercent}%</strong>
            {' · '}
            {countries.map((c) => (
              <span key={c.country} className="mr-3">
                {c.flag_emoji} ${Number(c.rate_per_kg_usd).toFixed(2)}/kg
              </span>
            ))}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('Country', 'Pays')} *</Label>
              <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c.country} value={c.country}>
                      {c.flag_emoji} {isFr ? c.label_fr : c.label_en} (${Number(c.rate_per_kg_usd).toFixed(2)}/kg)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('Source URL', 'URL source')} *</Label>
              <Input
                placeholder="https://..."
                value={form.product_url}
                onChange={(e) => setForm({ ...form, product_url: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('Title', 'Titre')} *</Label>
            <Input
              placeholder={t('Product title', 'Titre du produit')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('Image URL', 'URL image')} *</Label>
            <Input
              placeholder="https://..."
              value={form.image_url}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
            />
            {form.image_url && (
              <img
                src={form.image_url}
                alt="preview"
                className="h-24 w-24 object-cover rounded-md border border-border/40"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
              />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t('Base price (USD)', 'Prix de base (USD)')} *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="49.99"
                value={form.base_price_usd}
                onChange={(e) => setForm({ ...form, base_price_usd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('Estimated weight (kg)', 'Poids estimé (kg)')} *</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                placeholder="1.0"
                value={form.est_weight_kg}
                onChange={(e) => setForm({ ...form, est_weight_kg: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('Final price (auto)', 'Prix final (auto)')}</Label>
              <div className="h-10 flex items-center px-3 rounded-md border border-border/40 bg-muted/40 font-bold text-primary">
                {previewTotal != null ? `$${previewTotal}` : '—'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('Description (optional)', 'Description (optionnel)')}</Label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <Button onClick={handleAdd} disabled={saving} className="w-full md:w-auto">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            {t('Add product', 'Ajouter le produit')}
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg">
              {t('Existing products', 'Produits existants')} ({filteredProducts.length})
            </CardTitle>
            <Select value={filterCountry} onValueChange={setFilterCountry}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COUNTRY_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt === 'all'
                      ? t('All countries', 'Tous les pays')
                      : countries.find((c) => c.country === opt)
                        ? `${countries.find((c) => c.country === opt)!.flag_emoji} ${isFr ? countries.find((c) => c.country === opt)!.label_fr : countries.find((c) => c.country === opt)!.label_en}`
                        : opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filteredProducts.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">
              {t('No products yet', 'Aucun produit')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">{t('Image', 'Image')}</TableHead>
                    <TableHead>{t('Title', 'Titre')}</TableHead>
                    <TableHead>{t('Country', 'Pays')}</TableHead>
                    <TableHead className="text-right">{t('Base', 'Base')}</TableHead>
                    <TableHead className="text-right">{t('Wt (kg)', 'Poids')}</TableHead>
                    <TableHead className="text-right">{t('Final', 'Final')}</TableHead>
                    <TableHead>{t('Active', 'Actif')}</TableHead>
                    <TableHead className="text-right">{t('Actions', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((p) => {
                    const isEditing = editingId === p.id;
                    const total = isEditing
                      ? computeTotal(Number(editDraft.base_price_usd) || 0, Number(editDraft.est_weight_kg) || 0, editDraft.country || p.country)
                      : computeTotal(Number(p.base_price_usd), Number(p.est_weight_kg), p.country);
                    const c = countries.find((x) => x.country === (isEditing ? editDraft.country : p.country));
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <img
                            src={isEditing ? (editDraft.image_url || p.image_url) : p.image_url}
                            alt=""
                            className="h-12 w-12 object-cover rounded"
                            onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                          />
                        </TableCell>
                        <TableCell className="max-w-xs">
                          {isEditing ? (
                            <div className="space-y-1">
                              <Input value={editDraft.title || ''} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                              <Input value={editDraft.image_url || ''} onChange={(e) => setEditDraft({ ...editDraft, image_url: e.target.value })} placeholder="image url" className="text-xs" />
                              <Input value={editDraft.product_url || ''} onChange={(e) => setEditDraft({ ...editDraft, product_url: e.target.value })} placeholder="source url" className="text-xs" />
                            </div>
                          ) : (
                            <div>
                              <p className="text-sm font-medium line-clamp-2">{p.title}</p>
                              <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{t('Source', 'Source')} ↗</a>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Select value={editDraft.country || p.country} onValueChange={(v) => setEditDraft({ ...editDraft, country: v })}>
                              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {countries.map((cc) => (
                                  <SelectItem key={cc.country} value={cc.country}>{cc.flag_emoji} {cc.label_en}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline">{c?.flag_emoji} {c ? (isFr ? c.label_fr : c.label_en) : p.country}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <Input type="number" step="0.01" className="w-24 ml-auto" value={editDraft.base_price_usd as any ?? ''} onChange={(e) => setEditDraft({ ...editDraft, base_price_usd: Number(e.target.value) as any })} />
                          ) : (
                            `$${Number(p.base_price_usd).toFixed(2)}`
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <Input type="number" step="0.1" className="w-20 ml-auto" value={editDraft.est_weight_kg as any ?? ''} onChange={(e) => setEditDraft({ ...editDraft, est_weight_kg: Number(e.target.value) as any })} />
                          ) : (
                            Number(p.est_weight_kg).toFixed(1)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">${total}</TableCell>
                        <TableCell>
                          <Switch checked={p.is_active} onCheckedChange={() => handleToggleActive(p)} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {isEditing ? (
                              <>
                                <Button size="sm" onClick={saveEdit}><Save className="h-3.5 w-3.5" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditDraft({}); }}>×</Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="outline" onClick={() => startEdit(p)}>{t('Edit', 'Modifier')}</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
