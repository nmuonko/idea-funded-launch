import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Percent, DollarSign, Tag, Plus, Trash2, Save, Globe, Truck, RefreshCw, Car } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, Language, getAdminTranslation } from '@/lib/i18n/translations';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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
  }, []);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.settings.title}</h1>
          <p className="text-muted-foreground mt-2">
            {t.settings.description}
          </p>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {t.settings.saveChanges}
        </Button>
      </div>

      {/* Language Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t.settings.languagePreferences}
          </CardTitle>
          <CardDescription>
            {t.settings.languageDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={language}
            onValueChange={(value) => handleLanguageChange(value as Language)}
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
          >
            {languages.map((lang) => (
              <div
                key={lang.code}
                className={`flex items-center space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                  language === lang.code
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
                onClick={() => handleLanguageChange(lang.code)}
              >
                <RadioGroupItem value={lang.code} id={`lang-${lang.code}`} />
                <Label
                  htmlFor={`lang-${lang.code}`}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <span className="text-xl">{lang.flag}</span>
                  <span className="font-medium">{lang.name}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Currency Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            {t.settings.exchangeRate}
          </CardTitle>
          <CardDescription>
            USD to Congolese Franc conversion rate
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-md">
            <Label htmlFor="exchangeRate">1 USD =</Label>
            <div className="flex items-center gap-2">
              <Input
                id="exchangeRate"
                type="number"
                step="1"
                value={exchangeRateUsdToCdf}
                onChange={(e) => setExchangeRateUsdToCdf(Number(e.target.value))}
                className="flex-1"
              />
              <Badge variant="secondary" className="text-base px-3 py-1">
                FC
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profit Margin */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            {t.settings.profitMargin}
          </CardTitle>
          <CardDescription>
            {t.settings.profitMarginDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4 max-w-md">
              <div className="flex-1 space-y-2">
                <Label htmlFor="markupPercent">{t.settings.markupPercent}</Label>
                <Input
                  id="markupPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(parseFloat(e.target.value) || 0)}
                />
              </div>
              <Badge variant="outline" className="text-lg px-4 py-2 mt-6">
                {markupPercent}%
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t.settings.marginFormula}: {t.common.itemMargin} = {t.common.itemSubtotal} × {markupPercent}%
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Vehicle Pricing Tiers (USA → Dar es Salaam) */}
      <Card className="border-amber-500/30 bg-amber-50/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="h-5 w-5 text-amber-600" />
            {language === 'fr' ? 'Tarification Véhicules (USA → Dar es Salaam)' : 'Vehicle Pricing Tiers (USA → Dar es Salaam)'}
          </CardTitle>
          <CardDescription>
            {language === 'fr' 
              ? 'Pourcentage all-inclusive appliqué aux véhicules par tranche de prix. Inclut logistique, marge et buffer.'
              : 'All-inclusive percentage applied to vehicles by price bracket. Includes logistics, margin, and safety buffer.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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

          {/* Example */}
          <div className="bg-amber-500/10 rounded-lg p-4 border border-amber-500/20">
            <p className="text-sm font-medium mb-2 text-amber-700">
              {language === 'fr' ? 'Exemple:' : 'Example:'} $10,000 {language === 'fr' ? 'véhicule, roulant, RORO' : 'vehicle, running, RORO'}
            </p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">{language === 'fr' ? 'Prix de base' : 'Base price'}</p>
                <p className="font-semibold">$10,000</p>
              </div>
              <div>
                <p className="text-muted-foreground">{language === 'fr' ? 'Taux' : 'Rate'} ({vehicleTiers.tier_3_8000_to_11999_percent}%)</p>
                <p className="font-semibold text-amber-600">${(10000 * vehicleTiers.tier_3_8000_to_11999_percent / 100).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{language === 'fr' ? 'Prix final' : 'Final price'}</p>
                <p className="font-semibold">${(10000 * (1 + vehicleTiers.tier_3_8000_to_11999_percent / 100)).toLocaleString()}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {language === 'fr' 
                ? '* Couvre USA → Dar es Salaam uniquement. Douanes/transport DRC = couche séparée.'
                : '* Covers USA → Dar es Salaam only. DRC customs/inland delivery is a separate layer.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Shipping Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t.settings.shippingSettings}
          </CardTitle>
          <CardDescription>
            {t.settings.shippingFormula}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="shippingBase">{t.settings.baseShippingFee}</Label>
              <Input
                id="shippingBase"
                type="number"
                step="0.01"
                value={shippingBaseFeeUsd}
                onChange={(e) => setShippingBaseFeeUsd(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                {t.settings.flatFeeDesc}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shippingPercent">{t.settings.shippingPercentage}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="shippingPercent"
                  type="number"
                  step="0.1"
                  value={shippingPercent}
                  onChange={(e) => setShippingPercent(Number(e.target.value))}
                />
                <Badge variant="outline">{shippingPercent}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.settings.shippingPercentDesc}
              </p>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm font-medium mb-2">{t.settings.shippingFormula}:</p>
            <code className="text-xs bg-background px-2 py-1 rounded">
              ${shippingBaseFeeUsd.toFixed(2)} + ({t.common.orderSubtotal} × {shippingPercent}%)
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Example Calculation */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {t.settings.exampleCalculation}
          </CardTitle>
          <CardDescription>
            {t.settings.sampleOrder}: ${examplePrice} × {exampleQty} {t.common.items}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t.common.itemsSubtotal}</p>
              <p className="text-lg font-semibold">${exampleSubtotal.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t.common.margin} ({markupPercent}%)</p>
              <p className="text-lg font-semibold">${exampleMargin.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t.common.shippingFee}</p>
              <p className="text-lg font-semibold">${exampleShipping.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t.common.grandTotal}</p>
              <p className="text-lg font-bold text-primary">${exampleGrandTotal.toFixed(2)}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            CDF: {(exampleGrandTotal * exchangeRateUsdToCdf).toLocaleString()} FC
          </p>
        </CardContent>
      </Card>

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
    </div>
  );
}
