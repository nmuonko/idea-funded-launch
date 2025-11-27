import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Percent, DollarSign, Tag, Plus, Trash2, Save } from 'lucide-react';

export default function FeesSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalMarkup, setGlobalMarkup] = useState(15);
  const [categoryMarkups, setCategoryMarkups] = useState<Record<string, number>>({});
  const [extraFees, setExtraFees] = useState<any[]>([]);
  const [discountCodes, setDiscountCodes] = useState<any[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .single();

      if (error) throw error;

      setSettings(data);
      setGlobalMarkup((data.global_markup_percent || 0.15) * 100);
      setCategoryMarkups((data.category_markups || {}) as Record<string, number>);
      setExtraFees((data.extra_fees || []) as any[]);
      setDiscountCodes((data.discount_codes || []) as any[]);
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
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id);

      if (error) throw error;

      toast({
        title: 'Settings saved',
        description: 'Fees and markup settings updated successfully',
      });

      loadSettings();
    } catch (error: any) {
      toast({
        title: 'Error saving settings',
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
          <h1 className="text-3xl font-bold">Fees & Markup Settings</h1>
          <p className="text-muted-foreground mt-2">
            Configure pricing, fees, and discount codes
          </p>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>

      {/* Global Markup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            Global Markup
          </CardTitle>
          <CardDescription>
            Default markup percentage applied to all products
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="globalMarkup">Markup Percentage</Label>
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
                Category Markups
              </CardTitle>
              <CardDescription>
                Set specific markup percentages for product categories
              </CardDescription>
            </div>
            <Button onClick={addCategoryMarkup} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Category
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {Object.keys(categoryMarkups).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No category markups configured
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
                Extra Fees
              </CardTitle>
              <CardDescription>
                Additional fees like insurance, handling, etc.
              </CardDescription>
            </div>
            <Button onClick={addExtraFee} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Fee
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {extraFees.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No extra fees configured
            </p>
          ) : (
            <div className="space-y-4">
              {extraFees.map((fee, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div>
                        <Label>Fee Name</Label>
                        <Input
                          placeholder="e.g., Insurance"
                          value={fee.name}
                          onChange={(e) => updateExtraFee(index, 'name', e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Amount (USD)</Label>
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
                    <Label htmlFor={`fee-active-${index}`}>Active</Label>
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
                Discount Codes
              </CardTitle>
              <CardDescription>
                Promotional discount codes for customers
              </CardDescription>
            </div>
            <Button onClick={addDiscountCode} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Code
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {discountCodes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No discount codes configured
            </p>
          ) : (
            <div className="space-y-4">
              {discountCodes.map((code, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div>
                        <Label>Code</Label>
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
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`code-active-${index}`}
                        checked={code.active}
                        onChange={(e) => updateDiscountCode(index, 'active', e.target.checked)}
                        className="rounded"
                      />
                      <Label htmlFor={`code-active-${index}`}>Active</Label>
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
