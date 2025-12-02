import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Percent, DollarSign, Tag, Plus, Trash2, Save, Globe } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, Language, getAdminTranslation } from '@/lib/i18n/translations';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export default function FeesSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalMarkup, setGlobalMarkup] = useState(15);
  const [categoryMarkups, setCategoryMarkups] = useState<Record<string, number>>({});
  const [extraFees, setExtraFees] = useState<any[]>([]);
  const [discountCodes, setDiscountCodes] = useState<any[]>([]);
  const [serviceFeePercent, setServiceFeePercent] = useState(12);
  const [shippingBaseFeeUsd, setShippingBaseFeeUsd] = useState(10);
  const [shippingPercent, setShippingPercent] = useState(10);
  const [exchangeRateUsdToCdf, setExchangeRateUsdToCdf] = useState(2800);
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
      setGlobalMarkup((data.global_markup_percent || 0.15) * 100);
      setCategoryMarkups((data.category_markups || {}) as Record<string, number>);
      setExtraFees((data.extra_fees || []) as any[]);
      setDiscountCodes((data.discount_codes || []) as any[]);
      
      // Load core settings
      setServiceFeePercent((data.service_fee_percent || 0.12) * 100);
      setShippingBaseFeeUsd(data.shipping_base_fee_usd || 10);
      setShippingPercent((data.shipping_percent || 0.10) * 100);
      setExchangeRateUsdToCdf(data.exchange_rate_usd_to_cdf || 2800);
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

      const { error } = await supabase
        .from('settings')
        .update({
          global_markup_percent: globalMarkup / 100,
          category_markups: categoryMarkups,
          extra_fees: extraFees,
          discount_codes: discountCodes,
          service_fee_percent: serviceFeePercent / 100,
          shipping_base_fee_usd: shippingBaseFeeUsd,
          shipping_percent: shippingPercent / 100,
          exchange_rate_usd_to_cdf: exchangeRateUsdToCdf,
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

      {/* Core Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {t.settings.corePricing}
          </CardTitle>
          <CardDescription>
            {t.settings.corePricingDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="exchangeRate">{t.settings.exchangeRate}</Label>
              <Input
                id="exchangeRate"
                type="number"
                step="0.01"
                value={exchangeRateUsdToCdf}
                onChange={(e) => setExchangeRateUsdToCdf(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                1 USD = {exchangeRateUsdToCdf.toFixed(2)} FC
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="serviceFee">{t.settings.serviceFee}</Label>
              <Input
                id="serviceFee"
                type="number"
                step="0.01"
                value={serviceFeePercent}
                onChange={(e) => setServiceFeePercent(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                {serviceFeePercent.toFixed(2)}%
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shippingBase">{t.settings.baseShipping}</Label>
              <Input
                id="shippingBase"
                type="number"
                step="0.01"
                value={shippingBaseFeeUsd}
                onChange={(e) => setShippingBaseFeeUsd(Number(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="shippingPercent">{t.settings.shippingPercent}</Label>
              <Input
                id="shippingPercent"
                type="number"
                step="0.01"
                value={shippingPercent}
                onChange={(e) => setShippingPercent(Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Global Markup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            {t.settings.globalMarkup}
          </CardTitle>
          <CardDescription>
            {t.settings.globalMarkupDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="globalMarkup">{t.settings.markupPercent}</Label>
              <Input
                id="globalMarkup"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={globalMarkup}
                onChange={(e) => setGlobalMarkup(parseFloat(e.target.value) || 0)}
              />
            </div>
            <Badge variant="outline" className="text-lg px-4 py-2">
              {globalMarkup}%
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Category Markups */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                {t.settings.categoryMarkups}
              </CardTitle>
              <CardDescription>
                {t.settings.categoryMarkupsDesc}
              </CardDescription>
            </div>
            <Button onClick={addCategoryMarkup} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              {t.settings.addCategory}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {Object.keys(categoryMarkups).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
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
        </CardContent>
      </Card>

      {/* Extra Fees */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {t.settings.extraFees}
              </CardTitle>
              <CardDescription>
                {t.settings.extraFeesDesc}
              </CardDescription>
            </div>
            <Button onClick={addExtraFee} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              {t.settings.addFee}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {extraFees.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
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
        </CardContent>
      </Card>

      {/* Discount Codes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                {t.settings.discountCodes}
              </CardTitle>
              <CardDescription>
                {t.settings.discountCodesDesc}
              </CardDescription>
            </div>
            <Button onClick={addDiscountCode} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              {t.settings.addCode}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {discountCodes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
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
                        <Label>{t.settings.discountPercent}</Label>
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
                  <div className="flex items-center gap-4">
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
                    {code.active && (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        {code.percent}% OFF
                      </Badge>
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
