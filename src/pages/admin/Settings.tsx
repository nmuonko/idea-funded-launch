import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export default function AdminSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    serviceFeePercent: 0.12,
    shippingBaseFeeUsd: 10,
    shippingPercent: 0.10,
    exchangeRateUsdToCdf: 2800,
  });

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

      if (data) {
        setSettings({
          serviceFeePercent: Number(data.service_fee_percent),
          shippingBaseFeeUsd: Number(data.shipping_base_fee_usd),
          shippingPercent: Number(data.shipping_percent),
          exchangeRateUsdToCdf: Number(data.exchange_rate_usd_to_cdf),
        });
      }
    } catch (error: any) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from('settings')
        .update({
          service_fee_percent: settings.serviceFeePercent,
          shipping_base_fee_usd: settings.shippingBaseFeeUsd,
          shipping_percent: settings.shippingPercent,
          exchange_rate_usd_to_cdf: settings.exchangeRateUsdToCdf,
        })
        .eq('id', (await supabase.from('settings').select('id').single()).data?.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Settings updated successfully',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App Settings</CardTitle>
        <CardDescription>Configure pricing and exchange rates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="serviceFee">Service Fee (%)</Label>
          <Input
            id="serviceFee"
            type="number"
            step="0.01"
            value={settings.serviceFeePercent * 100}
            onChange={(e) => setSettings({ ...settings, serviceFeePercent: Number(e.target.value) / 100 })}
          />
          <p className="text-xs text-muted-foreground">
            Current: {(settings.serviceFeePercent * 100).toFixed(2)}%
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="shippingBase">Shipping Base Fee (USD)</Label>
          <Input
            id="shippingBase"
            type="number"
            step="0.01"
            value={settings.shippingBaseFeeUsd}
            onChange={(e) => setSettings({ ...settings, shippingBaseFeeUsd: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            Flat fee added to all shipments
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="shippingPercent">Shipping Percentage (%)</Label>
          <Input
            id="shippingPercent"
            type="number"
            step="0.01"
            value={settings.shippingPercent * 100}
            onChange={(e) => setSettings({ ...settings, shippingPercent: Number(e.target.value) / 100 })}
          />
          <p className="text-xs text-muted-foreground">
            Percentage of item total added as shipping
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="exchangeRate">USD to CDF Exchange Rate</Label>
          <Input
            id="exchangeRate"
            type="number"
            step="0.01"
            value={settings.exchangeRateUsdToCdf}
            onChange={(e) => setSettings({ ...settings, exchangeRateUsdToCdf: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            Current rate: 1 USD = {settings.exchangeRateUsdToCdf.toFixed(2)} FC
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Settings
        </Button>
      </CardContent>
    </Card>
  );
}
