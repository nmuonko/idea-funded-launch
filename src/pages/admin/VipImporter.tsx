import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeVipPrice } from '@/lib/vipPricing';
import { VIP_COLOR_PRESETS, sizePresetForCategory } from '@/lib/vipOptions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, Sparkles, Loader2, Check, X, Plus, AlertTriangle,
  ChevronRight, ChevronLeft, RefreshCw, ImageIcon, Trash2,
} from 'lucide-react';

interface VipCategory {
  id: string;
  name: string;
  name_fr: string | null;
  default_weight_kg: number;
  shipping_rate_per_kg: number | null;
  is_active: boolean;
}

interface ProcessedProduct {
  id: string;
  name_fr: string | null;
  description_fr: string | null;
  image_url: string;
  final_price: number | null;
  purchase_price: number | null;
  shipping_cost: number | null;
  shipping_buffer: number | null;
  profit: number | null;
  needs_review: boolean;
  review_reason: string | null;
  colors: string[];
  sizes: string[];
  ai_suggested: { item_type?: string; colors?: string[] };
}

type Step = 1 | 2 | 3 | 4;

export default function VipImporter() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [categories, setCategories] = useState<VipCategory[]>([]);
  const [settings, setSettings] = useState({ shipping_buffer_percent: 10, profit_markup_percent: 30 });

  // Batch details
  const [categoryId, setCategoryId] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [ratePerKg, setRatePerKg] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState('');
  const [customSize, setCustomSize] = useState('');

  // Images
  const [images, setImages] = useState<{ dataUrl: string; name: string }[]>([]);

  // Processing
  const [processing, setProcessing] = useState(false);
  const [products, setProducts] = useState<ProcessedProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);

  // New category dialog
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCat, setNewCat] = useState({ name: '', name_fr: '', weight: '0.5', rate: '30' });

  const category = categories.find((c) => c.id === categoryId);

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.from('vip_categories').select('*').order('name');
    setCategories((data as VipCategory[]) ?? []);
  }, []);

  useEffect(() => {
    loadCategories();
    supabase.from('vip_settings').select('shipping_buffer_percent, profit_markup_percent').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setSettings(data); });
  }, [loadCategories]);

  // When category changes, prefill weight/rate
  useEffect(() => {
    if (category) {
      setWeightKg(String(category.default_weight_kg));
      setRatePerKg(category.shipping_rate_per_kg != null ? String(category.shipping_rate_per_kg) : '');
      setSizes(sizePresetForCategory(category.name).slice(0, 0)); // start empty; presets shown as chips
    }
  }, [categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pricePreview = useMemo(() => {
    const p = Number(purchasePrice);
    const w = Number(weightKg);
    const r = Number(ratePerKg);
    if (p > 0 && w > 0 && r > 0) {
      return computeVipPrice(p, w, r, settings.shipping_buffer_percent, settings.profit_markup_percent);
    }
    return null;
  }, [purchasePrice, weightKg, ratePerKg, settings]);

  const sizePresets = category ? sizePresetForCategory(category.name) : sizePresetForCategory('');

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 50);
    list.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        setImages((prev) => [...prev, { dataUrl: String(reader.result), name: f.name }].slice(0, 50));
      };
      reader.readAsDataURL(f);
    });
  };

  const createCategory = async () => {
    const name = newCat.name.trim();
    if (!name) return;
    // Duplicate check
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Category already exists', variant: 'destructive' });
      return;
    }
    const { data, error } = await supabase.from('vip_categories').insert({
      name,
      name_fr: newCat.name_fr.trim() || null,
      default_weight_kg: Number(newCat.weight) || 0.5,
      shipping_rate_per_kg: Number(newCat.rate) > 0 ? Number(newCat.rate) : null,
    }).select('id').single();
    if (error) {
      toast({ title: 'Could not create category', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `Category "${name}" created` });
    setNewCatOpen(false);
    setNewCat({ name: '', name_fr: '', weight: '0.5', rate: '30' });
    await loadCategories();
    setCategoryId(data.id);
  };

  const processBatch = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('vip-ai-process', {
        body: {
          category_id: categoryId,
          purchase_price: Number(purchasePrice),
          weight_kg: Number(weightKg) || undefined,
          rate_per_kg: Number(ratePerKg) || undefined,
          colors,
          sizes,
          images: images.map((i) => i.dataUrl),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'processing_failed');

      const okProducts = (data.results as any[])
        .filter((r) => r.ok && r.product)
        .map((r) => r.product.id as string);

      // Load full product records for review
      const { data: full } = await supabase
        .from('vip_products')
        .select('id, name_fr, description_fr, image_url, final_price, purchase_price, shipping_cost, shipping_buffer, profit, needs_review, review_reason, colors, sizes, ai_suggested')
        .in('id', okProducts);
      setProducts((full as ProcessedProduct[]) ?? []);
      setSelected(new Set(okProducts));
      setStep(4);
    } catch (e: any) {
      toast({ title: 'AI processing failed', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const saveEdit = async (p: ProcessedProduct, patch: Partial<ProcessedProduct>) => {
    const { data, error } = await supabase.functions.invoke('vip-publish', {
      body: { action: 'edit', product_id: p.id, ...patch },
    });
    if (error || !data?.ok) {
      toast({ title: 'Save failed', description: error?.message ?? data?.error, variant: 'destructive' });
      return;
    }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  };

  const publish = async (ids: string[]) => {
    if (!ids.length) return;
    setPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke('vip-publish', {
        body: { action: 'publish', product_ids: ids },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast({
          title: 'Some products could not be published',
          description: data?.message ?? data?.error,
          variant: 'destructive',
        });
        return;
      }
      toast({ title: `${data.updated} product(s) published to /vip` });
      setProducts((prev) => prev.filter((p) => !ids.includes(p.id)));
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: 'Publish failed', description: e.message, variant: 'destructive' });
    } finally {
      setPublishing(false);
    }
  };

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const stepValid =
    step === 1 ? images.length > 0
    : step === 2 ? !!categoryId
    : step === 3 ? Number(purchasePrice) > 0
    : true;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> AI Clothing Importer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a batch of clothing photos, enter shared details once, and let AI prepare French listings for the VIP store.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {['Upload photos', 'Category', 'Batch details', 'Review & publish'].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border ${step === i + 1 ? 'bg-primary text-primary-foreground' : step > i + 1 ? 'bg-muted' : 'text-muted-foreground'}`}>
              {step > i + 1 ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>} {label}
            </span>
            {i < 3 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* STEP 1 — Upload */}
      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>Upload product photos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/50"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="font-medium">Drop photos here or click to browse</p>
              <p className="text-sm text-muted-foreground">Up to 50 photos per batch — all items in a batch share the same category, price and weight.</p>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
            {images.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative group aspect-square rounded-md overflow-hidden border">
                    <img src={img.dataUrl} alt={img.name} className="object-cover w-full h-full" />
                    <button
                      className="absolute top-1 right-1 bg-black/60 rounded-full p-1 opacity-0 group-hover:opacity-100"
                      onClick={() => setImages((prev) => prev.filter((_, x) => x !== i))}
                      aria-label="Remove image"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm text-muted-foreground">{images.length} photo(s) ready</p>
          </CardContent>
        </Card>
      )}

      {/* STEP 2 — Category */}
      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>Select the batch category</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {categories.filter((c) => c.is_active).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(c.id)}
                  className={`p-3 rounded-lg border text-left transition-colors ${categoryId === c.id ? 'border-primary bg-primary/10' : 'hover:bg-muted'}`}
                >
                  <p className="font-medium">{c.name_fr || c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.default_weight_kg} kg · {c.shipping_rate_per_kg != null ? `$${c.shipping_rate_per_kg}/kg` : 'rate not set'}
                  </p>
                </button>
              ))}
              <button
                onClick={() => setNewCatOpen(true)}
                className="p-3 rounded-lg border border-dashed text-left hover:bg-muted flex items-center gap-2"
              >
                <Plus className="h-4 w-4" /> <span className="font-medium">New category</span>
              </button>
            </div>
            {category && category.shipping_rate_per_kg == null && (
              <p className="text-sm text-amber-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> This category has no shipping rate — products will stay drafts until a rate is set in VIP Pricing Settings.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 3 — Batch details */}
      {step === 3 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Shared batch details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Original purchase price per item (USD)</Label>
                <Input type="number" min="0" step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="12.00" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Weight per item (kg)</Label>
                  <Input type="number" min="0" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
                </div>
                <div>
                  <Label>Shipping rate ($/kg)</Label>
                  <Input type="number" min="0" step="1" value={ratePerKg} onChange={(e) => setRatePerKg(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>Available colors</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {VIP_COLOR_PRESETS.map((c) => (
                    <button
                      key={c.fr}
                      onClick={() => toggle(colors, c.fr, setColors)}
                      className={`px-2.5 py-1 text-xs rounded-full border ${colors.includes(c.fr) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      {c.fr}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input value={customColor} onChange={(e) => setCustomColor(e.target.value)} placeholder="Custom color (e.g. Bleu ciel)" className="h-8 text-sm" />
                  <Button size="sm" variant="outline" onClick={() => { if (customColor.trim() && !colors.includes(customColor.trim())) setColors([...colors, customColor.trim()]); setCustomColor(''); }}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {colors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {colors.map((c) => (
                      <Badge key={c} variant="secondary" className="gap-1">{c}
                        <button onClick={() => setColors(colors.filter((x) => x !== c))} aria-label={`Remove ${c}`}><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label>Available sizes</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {sizePresets.map((s) => (
                    <button
                      key={s}
                      onClick={() => toggle(sizes, s, setSizes)}
                      className={`px-2.5 py-1 text-xs rounded-full border ${sizes.includes(s) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input value={customSize} onChange={(e) => setCustomSize(e.target.value)} placeholder="Custom size (e.g. Taille unique, 42 EU)" className="h-8 text-sm" />
                  <Button size="sm" variant="outline" onClick={() => { if (customSize.trim() && !sizes.includes(customSize.trim())) setSizes([...sizes, customSize.trim()]); setCustomSize(''); }}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {sizes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {sizes.map((s) => (
                      <Badge key={s} variant="secondary" className="gap-1">{s}
                        <button onClick={() => setSizes(sizes.filter((x) => x !== s))} aria-label={`Remove ${s}`}><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Price preview (per item)</CardTitle></CardHeader>
            <CardContent>
              {pricePreview ? (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Purchase price</dt><dd>${Number(purchasePrice).toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Shipping ({weightKg} kg × ${ratePerKg}/kg)</dt><dd>${pricePreview.shippingCost.toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Shipping buffer ({settings.shipping_buffer_percent}%)</dt><dd>${pricePreview.shippingBuffer.toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Profit ({settings.profit_markup_percent}% of purchase)</dt><dd>${pricePreview.profit.toFixed(2)}</dd></div>
                  <div className="flex justify-between font-semibold text-base border-t pt-2"><dt>Final VIP price</dt><dd>${pricePreview.finalPrice.toFixed(2)}</dd></div>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Enter purchase price, weight and rate to preview the final selling price.</p>
              )}
              <p className="text-xs text-muted-foreground mt-4">Final prices are calculated server-side at processing time using the current settings.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 4 — Review */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between flex-wrap gap-2">
              <span>Review {products.length} generated product(s)</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelected(new Set(products.map((p) => p.id)))}>Select all</Button>
                <Button size="sm" disabled={publishing || selected.size === 0} onClick={() => publish([...selected])}>
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Publish {selected.size} to VIP
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {products.length === 0 && <p className="text-sm text-muted-foreground">All products from this batch have been published.</p>}
            {products.map((p) => (
              <div key={p.id} className={`flex gap-3 p-3 rounded-lg border ${p.needs_review ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(p.id); else next.delete(p.id);
                    setSelected(next);
                  }}
                  aria-label={`Select ${p.name_fr ?? 'product'}`}
                  className="mt-1"
                />
                <img src={p.image_url} alt={p.name_fr ?? ''} className="w-20 h-20 object-cover rounded-md border" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  {p.needs_review && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {p.review_reason === 'category_mismatch'
                        ? `AI thinks this is "${p.ai_suggested?.item_type}" — please verify the category`
                        : p.review_reason === 'missing_shipping_rate'
                          ? 'Missing shipping rate — set one in VIP Pricing Settings'
                          : 'AI processing failed — edit manually'}
                    </p>
                  )}
                  <Input
                    value={p.name_fr ?? ''}
                    onChange={(e) => setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, name_fr: e.target.value } : x)))}
                    onBlur={() => saveEdit(p, { name_fr: p.name_fr ?? '' })}
                    placeholder="Product name (French)"
                    className="h-8 font-medium"
                  />
                  <Textarea
                    value={p.description_fr ?? ''}
                    onChange={(e) => setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, description_fr: e.target.value } : x)))}
                    onBlur={() => saveEdit(p, { description_fr: p.description_fr ?? '' })}
                    placeholder="Description (French)"
                    rows={2}
                    className="text-sm"
                  />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Purchase: ${p.purchase_price?.toFixed(2) ?? '—'}</span>
                    <span>Shipping: ${p.shipping_cost?.toFixed(2) ?? '—'}</span>
                    <span>Buffer: ${p.shipping_buffer?.toFixed(2) ?? '—'}</span>
                    <span>Profit: ${p.profit?.toFixed(2) ?? '—'}</span>
                    <span className="font-semibold text-foreground">Final: ${p.final_price?.toFixed(2) ?? '—'}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Nav buttons */}
      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 1 || processing} onClick={() => setStep((s) => (s - 1) as Step)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        {step < 3 && (
          <Button disabled={!stepValid} onClick={() => setStep((s) => (s + 1) as Step)}>
            Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
        {step === 3 && (
          <Button disabled={!stepValid || processing} onClick={processBatch}>
            {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {processing ? 'AI is processing…' : `Process ${images.length} photo(s) with AI`}
          </Button>
        )}
        {step === 4 && (
          <Button variant="outline" onClick={() => { setStep(1); setImages([]); setProducts([]); setSelected(new Set()); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> New batch
          </Button>
        )}
      </div>

      {/* New category dialog */}
      <Dialog open={newCatOpen} onOpenChange={setNewCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new category</DialogTitle>
            <DialogDescription>It will be available for future uploads and in VIP Pricing Settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Category name (English)</Label><Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="Baby Clothing" /></div>
            <div><Label>French name (optional)</Label><Input value={newCat.name_fr} onChange={(e) => setNewCat({ ...newCat, name_fr: e.target.value })} placeholder="Vêtements Bébé" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Default weight (kg)</Label><Input type="number" step="0.1" value={newCat.weight} onChange={(e) => setNewCat({ ...newCat, weight: e.target.value })} /></div>
              <div><Label>Shipping rate ($/kg)</Label><Input type="number" step="1" value={newCat.rate} onChange={(e) => setNewCat({ ...newCat, rate: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCatOpen(false)}>Cancel</Button>
            <Button onClick={createCategory} disabled={!newCat.name.trim()}>Create category</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
