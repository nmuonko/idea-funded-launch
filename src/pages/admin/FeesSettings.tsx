import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Percent, DollarSign, Tag, Plus, Trash2, Save, Globe, Truck, RefreshCw, Car, Pencil, Package, AlertTriangle, Calculator } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, Language, getAdminTranslation } from '@/lib/i18n/translations';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function FeesSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Core settings
  const [exchangeRateUsdToCdf, setExchangeRateUsdToCdf] = useState(2800);
  const [markupPercent, setMarkupPercent] = useState(15);
  const [vehicleMarkupPercent, setVehicleMarkupPercent] = useState(18);
  const [shippingBaseFeeUsd, setShippingBaseFeeUsd] = useState(20);
  const [shippingPercent, setShippingPercent] = useState(10);
  const [shippingRatePerKg, setShippingRatePerKg] = useState(20);
  
  // Vehicle pricing tiers
  const [vehicleTiers, setVehicleTiers] = useState({
    tier_1_under_5000_percent: 70,
    tier_2_5000_to_7999_percent: 58,
    tier_3_8000_to_11999_percent: 48,
    tier_4_12000_to_17999_percent: 40,
    tier_5_18000_to_24999_percent: 34,
    tier_6_25000_plus_percent: 28,
    non_running_extra_percent: 7,
    container_extra_percent: 8,
    default_shipping_method: 'roro' as string,
    default_vehicle_condition: 'running' as string,
  });
  
  // Advanced settings
  const [categoryMarkups, setCategoryMarkups] = useState<Record<string, number>>({});
  const [extraFees, setExtraFees] = useState<any[]>([]);
  const [discountCodes, setDiscountCodes] = useState<any[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Shipping categories (inline management)
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [shippingTypeDialogOpen, setShippingTypeDialogOpen] = useState(false);
  const [editingShippingType, setEditingShippingType] = useState<any>(null);
  const [shippingTypeForm, setShippingTypeForm] = useState({
    key: '', label: '', description: '', est_weight_kg: '',
    flat_shipping_usd: '', shipping_buffer_percent: '25',
    requires_manual_quote: false, active: true,
  });

  // Price simulator
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [simPrice, setSimPrice] = useState(50);
  const [simWeight, setSimWeight] = useState(2);
  const [simCategory, setSimCategory] = useState('custom');
  const [simIsVehicle, setSimIsVehicle] = useState(false);

  const simResult = useMemo(() => {
    if (simIsVehicle) {
      // Vehicle tier calculation
      const tiers = [
        { max: 5000, pct: vehicleTiers.tier_1_under_5000_percent },
        { max: 8000, pct: vehicleTiers.tier_2_5000_to_7999_percent },
        { max: 12000, pct: vehicleTiers.tier_3_8000_to_11999_percent },
        { max: 18000, pct: vehicleTiers.tier_4_12000_to_17999_percent },
        { max: 25000, pct: vehicleTiers.tier_5_18000_to_24999_percent },
        { max: Infinity, pct: vehicleTiers.tier_6_25000_plus_percent },
      ];
      const tier = tiers.find(t => simPrice < t.max) || tiers[tiers.length - 1];
      const fee = simPrice * (tier.pct / 100);
      return { base: simPrice, markup: 0, shipping: fee, buffer: 0, total: simPrice + fee, tierPct: tier.pct, mode: 'vehicle' as const };
    }

    // Regular product
    const cat = shippingTypes.find((s: any) => s.key === simCategory);
    const weight = cat ? cat.est_weight_kg : simWeight;
    const flatRate = cat?.flat_shipping_usd;
    const bufferPct = cat ? cat.shipping_buffer_percent : 25;

    const markupAmt = simPrice * (markupPercent / 100);
    let baseShipping: number;
    if (flatRate != null && flatRate > 0) {
      baseShipping = flatRate;
    } else {
      baseShipping = weight * shippingRatePerKg;
    }
    const bufferAmt = baseShipping * (bufferPct / 100);
    const totalShipping = baseShipping + bufferAmt;
    const total = simPrice + markupAmt + totalShipping;

    return {
      base: simPrice, markup: markupAmt, shipping: baseShipping, buffer: bufferAmt,
      total: Math.round(total * 100) / 100, weight, bufferPct, flatRate,
      mode: 'regular' as const,
    };
  }, [simPrice, simWeight, simCategory, simIsVehicle, markupPercent, shippingRatePerKg, shippingTypes, vehicleTiers]);
  
  const { toast } = useToast();
  const { language, setLanguage } = useLanguage();
  const t = getAdminTranslation(language);

  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    toast({
      title: t.settings.languageUpdated,
      description: `${languages.find(l => l.code === newLang)?.name}`,
    });
  };

  useEffect(() => {
    loadSettings();
    loadShippingTypes();
  }, []);

  const loadShippingTypes = async () => {
    const { data, error } = await supabase
      .from('shipping_item_types')
      .select('*')
      .order('label');
    if (!error) setShippingTypes((data as any[]) || []);
  };

  const openEditShippingType = (type: any) => {
    setEditingShippingType(type);
    setShippingTypeForm({
      key: type.key, label: type.label, description: type.description || '',
      est_weight_kg: type.est_weight_kg.toString(),
      flat_shipping_usd: type.flat_shipping_usd?.toString() || '',
      shipping_buffer_percent: type.shipping_buffer_percent.toString(),
      requires_manual_quote: type.requires_manual_quote, active: type.active,
    });
    setShippingTypeDialogOpen(true);
  };

  const openAddShippingType = () => {
    setEditingShippingType(null);
    setShippingTypeForm({
      key: '', label: '', description: '', est_weight_kg: '',
      flat_shipping_usd: '', shipping_buffer_percent: '25',
      requires_manual_quote: false, active: true,
    });
    setShippingTypeDialogOpen(true);
  };

  const handleShippingTypeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const weight = parseFloat(shippingTypeForm.est_weight_kg);
    if (isNaN(weight) || weight <= 0) { toast({ title: 'Invalid weight', variant: 'destructive' }); return; }
    const payload: any = {
      key: shippingTypeForm.key.toLowerCase().replace(/\s+/g, '_'),
      label: shippingTypeForm.label,
      description: shippingTypeForm.description || null,
      est_weight_kg: weight,
      flat_shipping_usd: shippingTypeForm.flat_shipping_usd ? parseFloat(shippingTypeForm.flat_shipping_usd) : null,
      shipping_buffer_percent: parseFloat(shippingTypeForm.shipping_buffer_percent) || 0,
      requires_manual_quote: shippingTypeForm.requires_manual_quote,
      active: shippingTypeForm.active,
    };
    const { error } = editingShippingType
      ? await supabase.from('shipping_item_types').update(payload).eq('id', editingShippingType.id)
      : await supabase.from('shipping_item_types').insert(payload);
    if (error) {
      toast({ title: 'Error saving shipping type', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: editingShippingType ? 'Shipping type updated' : 'Shipping type created' });
      setShippingTypeDialogOpen(false);
      loadShippingTypes();
    }
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (error) throw error;

      setSettings(data);
      
      // Core settings - markup_percent is always stored as whole number (15 = 15%)
      // DO NOT convert values ≤1 to percentages - 1 means 1%, not 100%
      const markupVal = data.markup_percent ?? data.global_markup_percent ?? 15;
      setMarkupPercent(markupVal);
      
      setExchangeRateUsdToCdf(data.exchange_rate_usd_to_cdf || 2800);
      setShippingBaseFeeUsd(data.shipping_base_fee_usd || 20);
      setShippingRatePerKg((data as any).shipping_rate_per_kg ?? 20);
      
      // Shipping percent stored as whole number (10 = 10%)
      const shippingVal = data.shipping_percent ?? 10;
      setShippingPercent(shippingVal);
      
      // Advanced settings - load category markups including vehicles
      const loadedCategoryMarkups = (data.category_markups || {}) as Record<string, number>;
      setCategoryMarkups(loadedCategoryMarkups);
      
      // Load vehicle markup from category_markups.vehicles or default to general markup
      // Values are always whole percentages (1 = 1%, not 100%)
      const vehicleVal = loadedCategoryMarkups.vehicles ?? markupVal;
      setVehicleMarkupPercent(vehicleVal);
      
      setExtraFees((data.extra_fees || []) as any[]);
      setDiscountCodes((data.discount_codes || []) as any[]);
      
      // Load vehicle pricing tiers
      const tiers = data.vehicle_pricing_tiers as Record<string, any> | null;
      if (tiers) {
        setVehicleTiers(prev => ({ ...prev, ...tiers }));
      }
    } catch (error: any) {
      toast({
        title: 'Error loading settings',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setSaving(true);

      // Update category_markups with vehicle markup
      const updatedCategoryMarkups = {
        ...categoryMarkups,
        vehicles: vehicleMarkupPercent,  // Store vehicle markup in category_markups
      };

      const { error } = await supabase
        .from('settings')
        .update({
          markup_percent: markupPercent,
          global_markup_percent: markupPercent / 100,
          shipping_base_fee_usd: shippingBaseFeeUsd,
          shipping_percent: shippingPercent,
          shipping_rate_per_kg: shippingRatePerKg,
          exchange_rate_usd_to_cdf: exchangeRateUsdToCdf,
          category_markups: updatedCategoryMarkups,
          extra_fees: extraFees,
          discount_codes: discountCodes,
          vehicle_pricing_tiers: vehicleTiers,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id);

      if (error) throw error;

      toast({
        title: t.settings.settingsSaved,
        description: t.settings.settingsSavedDesc,
      });

      loadSettings();
    } catch (error: any) {
      toast({
        title: t.common.error,
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const addCategoryMarkup = () => {
    const category = prompt('Enter category name:');
    if (category) {
      setCategoryMarkups({ ...categoryMarkups, [category]: 15 });
    }
  };

  const removeCategoryMarkup = (category: string) => {
    const { [category]: _, ...rest } = categoryMarkups;
    setCategoryMarkups(rest);
  };

  const addExtraFee = () => {
    setExtraFees([...extraFees, { name: '', amount: 0, type: 'fixed', active: true }]);
  };

  const updateExtraFee = (index: number, field: string, value: any) => {
    const updated = [...extraFees];
    updated[index] = { ...updated[index], [field]: value };
    setExtraFees(updated);
  };

  const removeExtraFee = (index: number) => {
    setExtraFees(extraFees.filter((_, i) => i !== index));
  };

  const addDiscountCode = () => {
    setDiscountCodes([...discountCodes, { code: '', percent: 10, active: true }]);
  };

  const updateDiscountCode = (index: number, field: string, value: any) => {
    const updated = [...discountCodes];
    updated[index] = { ...updated[index], [field]: value };
    setDiscountCodes(updated);
  };

  const removeDiscountCode = (index: number) => {
    setDiscountCodes(discountCodes.filter((_, i) => i !== index));
  };

  // Calculate example pricing
  const examplePrice = 100;
  const exampleQty = 2;
  const exampleSubtotal = examplePrice * exampleQty;
  const exampleMargin = exampleSubtotal * (markupPercent / 100);
  const exampleItemsTotal = exampleSubtotal + exampleMargin;
  const exampleShipping = shippingBaseFeeUsd + (exampleSubtotal * (shippingPercent / 100));
  const exampleGrandTotal = exampleItemsTotal + exampleShipping;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.settings.title}</h1>
          <p className="text-sm text-muted-foreground">{t.settings.description}</p>
        </div>
        <Button onClick={saveSettings} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          {t.settings.saveChanges}
        </Button>
      </div>

      {/* Exchange Rate + Markup — compact row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> {t.settings.exchangeRate}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Label className="shrink-0">1 USD =</Label>
              <Input type="number" step="1" value={exchangeRateUsdToCdf} onChange={(e) => setExchangeRateUsdToCdf(Number(e.target.value))} className="w-32" />
              <Badge variant="secondary">FC</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Percent className="h-4 w-4" /> {t.settings.profitMargin}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Label className="shrink-0">{t.settings.markupPercent}</Label>
              <Input type="number" min="0" max="100" step="0.1" value={markupPercent} onChange={(e) => setMarkupPercent(parseFloat(e.target.value) || 0)} className="w-24" />
              <Badge variant="outline">{markupPercent}%</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t.common.itemMargin} = {t.common.itemSubtotal} × {markupPercent}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle Pricing Tiers */}
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4 text-amber-600" />
              Vehicle Pricing Tiers (USA → Dar es Salaam)
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => { setSimIsVehicle(true); setSimPrice(10000); setSimulatorOpen(true); }}>
              <Calculator className="h-4 w-4 mr-1" /> Simulate
            </Button>
          </div>
          <CardDescription className="text-xs">All-inclusive % by price bracket. Includes logistics, margin, and buffer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tier Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { key: 'tier_1_under_5000_percent', label: '< $5,000' },
              { key: 'tier_2_5000_to_7999_percent', label: '$5,000 – $7,999' },
              { key: 'tier_3_8000_to_11999_percent', label: '$8,000 – $11,999' },
              { key: 'tier_4_12000_to_17999_percent', label: '$12,000 – $17,999' },
              { key: 'tier_5_18000_to_24999_percent', label: '$18,000 – $24,999' },
              { key: 'tier_6_25000_plus_percent', label: '$25,000+' },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="0" max="200" step="1"
                    value={(vehicleTiers as any)[key]}
                    onChange={(e) => setVehicleTiers(prev => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Surcharges */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{language === 'fr' ? 'Supplément non-roulant' : 'Non-running surcharge'}</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min="0" max="50" step="1"
                  value={vehicleTiers.non_running_extra_percent}
                  onChange={(e) => setVehicleTiers(prev => ({ ...prev, non_running_extra_percent: Number(e.target.value) || 0 }))}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{language === 'fr' ? 'Supplément container' : 'Container surcharge'}</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min="0" max="50" step="1"
                  value={vehicleTiers.container_extra_percent}
                  onChange={(e) => setVehicleTiers(prev => ({ ...prev, container_extra_percent: Number(e.target.value) || 0 }))}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          {/* Inline example */}
          <p className="text-xs text-muted-foreground">
            Example: $10,000 vehicle at {vehicleTiers.tier_3_8000_to_11999_percent}% → ${(10000 * (1 + vehicleTiers.tier_3_8000_to_11999_percent / 100)).toLocaleString()} final. USA → Dar es Salaam only.
          </p>
        </CardContent>
      </Card>

      {/* Shipping Settings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" /> {t.settings.shippingSettings}
              </CardTitle>
              <CardDescription className="text-xs">Buffer applies to shipping cost only, not the product price.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setSimIsVehicle(false); setSimPrice(50); setSimulatorOpen(true); }}>
              <Calculator className="h-4 w-4 mr-1" /> Simulate
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Rate per KG ($)</Label>
              <Input type="number" step="0.5" min="0" value={shippingRatePerKg} onChange={(e) => setShippingRatePerKg(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Legacy Base Fee ($)</Label>
              <Input type="number" step="0.01" value={shippingBaseFeeUsd} onChange={(e) => setShippingBaseFeeUsd(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Legacy Shipping %</Label>
              <Input type="number" step="0.1" value={shippingPercent} onChange={(e) => setShippingPercent(Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Formula: (Weight × ${shippingRatePerKg}/kg OR Flat Rate) × (1 + Buffer%). Legacy fields used only if category detection fails.
          </p>
        </CardContent>
      </Card>

      {/* Shipping Categories (inline) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" /> Shipping Categories
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => { setSimIsVehicle(false); setSimPrice(50); setSimulatorOpen(true); }}>
                <Calculator className="h-4 w-4 mr-1" /> Simulate
              </Button>
              <Button size="sm" onClick={openAddShippingType}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
                <TableHead className="text-right">Flat Ship ($)</TableHead>
                <TableHead className="text-right">Buffer (%)</TableHead>
                <TableHead className="text-center">Manual Quote</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shippingTypes.map((st: any) => (
                <TableRow key={st.id} className={!st.active ? 'opacity-50' : ''}>
                  <TableCell>
                    <div className="font-medium">{st.label}</div>
                    {st.description && <div className="text-xs text-muted-foreground">{st.description}</div>}
                  </TableCell>
                  <TableCell className="text-right">{st.est_weight_kg} kg</TableCell>
                  <TableCell className="text-right">
                    {st.flat_shipping_usd != null ? `$${st.flat_shipping_usd}` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {st.shipping_buffer_percent > 0 ? `${st.shipping_buffer_percent}%` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {st.requires_manual_quote ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">No</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={st.active ? 'default' : 'outline'}>{st.active ? 'Active' : 'Off'}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEditShippingType(st)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Shipping Type Edit Dialog */}
      <Dialog open={shippingTypeDialogOpen} onOpenChange={setShippingTypeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingShippingType ? 'Edit Shipping Category' : 'Add Shipping Category'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleShippingTypeSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Key (internal)</Label>
              <Input value={shippingTypeForm.key} onChange={(e) => setShippingTypeForm({ ...shippingTypeForm, key: e.target.value })} placeholder="small_electronics" required />
            </div>
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={shippingTypeForm.label} onChange={(e) => setShippingTypeForm({ ...shippingTypeForm, label: e.target.value })} placeholder="Small electronics" required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={shippingTypeForm.description} onChange={(e) => setShippingTypeForm({ ...shippingTypeForm, description: e.target.value })} placeholder="Phones, earbuds, cameras" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Weight (kg)</Label>
                <Input type="number" step="0.1" min="0.1" value={shippingTypeForm.est_weight_kg} onChange={(e) => setShippingTypeForm({ ...shippingTypeForm, est_weight_kg: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Flat Shipping ($)</Label>
                <Input type="number" step="0.01" min="0" value={shippingTypeForm.flat_shipping_usd} onChange={(e) => setShippingTypeForm({ ...shippingTypeForm, flat_shipping_usd: e.target.value })} placeholder="Leave blank for weight-based" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Buffer (%)</Label>
              <Input type="number" step="1" min="0" max="100" value={shippingTypeForm.shipping_buffer_percent} onChange={(e) => setShippingTypeForm({ ...shippingTypeForm, shipping_buffer_percent: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Requires manual quote</Label>
              <Switch checked={shippingTypeForm.requires_manual_quote} onCheckedChange={(c) => setShippingTypeForm({ ...shippingTypeForm, requires_manual_quote: c })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={shippingTypeForm.active} onCheckedChange={(c) => setShippingTypeForm({ ...shippingTypeForm, active: c })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShippingTypeDialogOpen(false)}>Cancel</Button>
              <Button type="submit">{editingShippingType ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>




      {/* Advanced Settings (Collapsible) */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Tag className="h-5 w-5" />
                    {t.settings.advancedSettings}
                  </CardTitle>
                  <CardDescription>
                    {t.settings.advancedSettingsDesc}
                  </CardDescription>
                </div>
                <Badge variant="outline">
                  {advancedOpen ? t.common.clickToCollapse : t.common.clickToExpand}
                </Badge>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-8 pt-0">
              {/* Category Markups */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{t.settings.categoryMarkups}</h4>
                    <p className="text-sm text-muted-foreground">{t.settings.categoryMarkupsDesc}</p>
                  </div>
                  <Button onClick={addCategoryMarkup} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    {t.settings.addCategory}
                  </Button>
                </div>
                {Object.keys(categoryMarkups).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                    {t.settings.noCategories}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(categoryMarkups).map(([category, percent]) => (
                      <div key={category} className="flex items-center gap-3">
                        <div className="flex-1">
                          <Label className="capitalize">{category}</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={percent}
                            onChange={(e) => setCategoryMarkups({
                              ...categoryMarkups,
                              [category]: parseFloat(e.target.value) || 0
                            })}
                          />
                        </div>
                        <Badge variant="outline">{percent}%</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeCategoryMarkup(category)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Extra Fees */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{t.settings.extraFees}</h4>
                    <p className="text-sm text-muted-foreground">{t.settings.extraFeesDesc}</p>
                  </div>
                  <Button onClick={addExtraFee} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    {t.settings.addFee}
                  </Button>
                </div>
                {extraFees.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                    {t.settings.noFees}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {extraFees.map((fee, index) => (
                      <div key={index} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 grid grid-cols-2 gap-3">
                            <div>
                              <Label>{t.settings.feeName}</Label>
                              <Input
                                placeholder="e.g., Insurance"
                                value={fee.name}
                                onChange={(e) => updateExtraFee(index, 'name', e.target.value)}
                              />
                            </div>
                            <div>
                              <Label>{t.settings.amount}</Label>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={fee.amount}
                                onChange={(e) => updateExtraFee(index, 'amount', parseFloat(e.target.value) || 0)}
                              />
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeExtraFee(index)}
                            className="mt-6"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`fee-active-${index}`}
                            checked={fee.active}
                            onChange={(e) => updateExtraFee(index, 'active', e.target.checked)}
                            className="rounded"
                          />
                          <Label htmlFor={`fee-active-${index}`}>{t.settings.active}</Label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Discount Codes */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{t.settings.discountCodes}</h4>
                    <p className="text-sm text-muted-foreground">{t.settings.discountCodesDesc}</p>
                  </div>
                  <Button onClick={addDiscountCode} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    {t.settings.addCode}
                  </Button>
                </div>
                {discountCodes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                    {t.settings.noCodes}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {discountCodes.map((code, index) => (
                      <div key={index} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 grid grid-cols-2 gap-3">
                            <div>
                              <Label>{t.settings.code}</Label>
                              <Input
                                placeholder="e.g., SAVE10"
                                value={code.code}
                                onChange={(e) => updateDiscountCode(index, 'code', e.target.value.toUpperCase())}
                              />
                            </div>
                            <div>
                              <Label>Discount %</Label>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="1"
                                value={code.percent}
                                onChange={(e) => updateDiscountCode(index, 'percent', parseFloat(e.target.value) || 0)}
                              />
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeDiscountCode(index)}
                            className="mt-6"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`code-active-${index}`}
                            checked={code.active}
                            onChange={(e) => updateDiscountCode(index, 'active', e.target.checked)}
                            className="rounded"
                          />
                          <Label htmlFor={`code-active-${index}`}>{t.settings.active}</Label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Price Simulator Dialog */}
      <Dialog open={simulatorOpen} onOpenChange={setSimulatorOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Price Simulator
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Toggle vehicle vs regular */}
            <div className="flex items-center gap-4">
              <Button size="sm" variant={!simIsVehicle ? 'default' : 'outline'} onClick={() => setSimIsVehicle(false)}>
                <Package className="h-4 w-4 mr-1" /> Regular Item
              </Button>
              <Button size="sm" variant={simIsVehicle ? 'default' : 'outline'} onClick={() => setSimIsVehicle(true)}>
                <Car className="h-4 w-4 mr-1" /> Vehicle
              </Button>
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Item Price ($)</Label>
                <Input type="number" min="1" step="1" value={simPrice} onChange={e => setSimPrice(Number(e.target.value) || 0)} />
              </div>
              {!simIsVehicle && (
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={simCategory} onValueChange={v => { setSimCategory(v); if (v === 'custom') setSimWeight(2); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Custom weight</SelectItem>
                      {shippingTypes.filter((s: any) => s.active).map((s: any) => (
                        <SelectItem key={s.key} value={s.key}>{s.label} ({s.est_weight_kg}kg{s.flat_shipping_usd ? `, $${s.flat_shipping_usd} flat` : ''})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!simIsVehicle && simCategory === 'custom' && (
                <div className="space-y-1">
                  <Label>Weight (kg)</Label>
                  <Input type="number" min="0.1" step="0.1" value={simWeight} onChange={e => setSimWeight(Number(e.target.value) || 0)} />
                </div>
              )}
            </div>

            {/* Results */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold">Breakdown</p>
              {simResult.mode === 'vehicle' ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Base price</span><span>${simResult.base.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tier fee ({simResult.tierPct}%)</span><span className="text-amber-600">${simResult.shipping.toLocaleString()}</span></div>
                  <div className="border-t pt-2 flex justify-between font-bold"><span>Customer pays</span><span className="text-primary">${simResult.total.toLocaleString()}</span></div>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Base price</span><span>${simResult.base.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Markup ({markupPercent}%)</span><span>+${simResult.markup.toFixed(2)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Shipping {simResult.flatRate ? `($${simResult.flatRate} flat)` : `(${simResult.weight}kg × $${shippingRatePerKg}/kg)`}
                    </span>
                    <span>+${simResult.shipping.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Buffer ({simResult.bufferPct}% of shipping)</span><span>+${simResult.buffer.toFixed(2)}</span></div>
                  <div className="border-t pt-2 flex justify-between font-bold"><span>Customer pays</span><span className="text-primary">${simResult.total.toFixed(2)}</span></div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
