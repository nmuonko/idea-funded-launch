import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, CreditCard, Smartphone, DollarSign, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format } from 'date-fns';

interface PaymentSettings {
  id: string;
  mobile_money_max_usd: number;
  mobile_money_max_cdf: number;
  large_order_currency: string;
  stripe_enabled: boolean;
  bank_transfer_enabled: boolean;
  pawapay_enabled: boolean;
  updated_at: string;
}

export default function PaymentLimitsContent() {
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [mobileMoneyMaxUsd, setMobileMoneyMaxUsd] = useState(250);
  const [mobileMoneyMaxCdf, setMobileMoneyMaxCdf] = useState(1500000);
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [pawapayEnabled, setPawapayEnabled] = useState(true);
  
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('payment_settings')
        .select('*')
        .limit(1)
        .single();

      if (error) {
        // If no row exists, that's okay - we'll use defaults
        if (error.code === 'PGRST116') {
          console.log('No payment_settings row found, using defaults');
          return;
        }
        throw error;
      }

      if (data) {
        setSettings(data);
        setMobileMoneyMaxUsd(data.mobile_money_max_usd);
        setMobileMoneyMaxCdf(data.mobile_money_max_cdf);
        setStripeEnabled(data.stripe_enabled);
        setPawapayEnabled(data.pawapay_enabled);
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

      if (!settings?.id) {
        toast({
          title: 'Error',
          description: 'No settings record found. Please contact support.',
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabase
        .from('payment_settings')
        .update({
          mobile_money_max_usd: mobileMoneyMaxUsd,
          mobile_money_max_cdf: mobileMoneyMaxCdf,
          stripe_enabled: stripeEnabled,
          pawapay_enabled: pawapayEnabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id);

      if (error) throw error;

      toast({
        title: language === 'fr' ? 'Paramètres sauvegardés' : 'Settings saved',
        description: language === 'fr' 
          ? 'Les limites de paiement ont été mises à jour.' 
          : 'Payment limits have been updated.',
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
          {settings?.updated_at && (
            <p className="text-sm text-muted-foreground">
              {language === 'fr' ? 'Dernière mise à jour: ' : 'Last updated: '}
              {format(new Date(settings.updated_at), 'PPpp')}
            </p>
          )}
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

      {/* Mobile Money Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            {language === 'fr' ? 'Limites Mobile Money (pawaPay)' : 'Mobile Money Limits (pawaPay)'}
          </CardTitle>
          <CardDescription>
            {language === 'fr' 
              ? 'Les commandes dépassant ces limites devront utiliser Stripe' 
              : 'Orders exceeding these limits will need to use Stripe'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="maxUsd" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                {language === 'fr' ? 'Limite USD' : 'USD Limit'}
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  id="maxUsd"
                  type="number"
                  min="0"
                  step="10"
                  value={mobileMoneyMaxUsd}
                  onChange={(e) => setMobileMoneyMaxUsd(Number(e.target.value))}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {language === 'fr' 
                  ? 'Maximum pour les paiements en USD via Mobile Money' 
                  : 'Maximum for USD payments via Mobile Money'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxCdf" className="flex items-center gap-2">
                <span className="text-xs font-bold">FC</span>
                {language === 'fr' ? 'Limite CDF' : 'CDF Limit'}
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">FC</span>
                <Input
                  id="maxCdf"
                  type="number"
                  min="0"
                  step="10000"
                  value={mobileMoneyMaxCdf}
                  onChange={(e) => setMobileMoneyMaxCdf(Number(e.target.value))}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {language === 'fr' 
                  ? 'Maximum pour les paiements en CDF via Mobile Money' 
                  : 'Maximum for CDF payments via Mobile Money'}
              </p>
            </div>
          </div>

          {/* Limit explanation */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'fr' 
                ? `Commandes > $${mobileMoneyMaxUsd.toLocaleString()} ou FC ${mobileMoneyMaxCdf.toLocaleString()} seront redirigées vers Stripe (carte).` 
                : `Orders > $${mobileMoneyMaxUsd.toLocaleString()} or FC ${mobileMoneyMaxCdf.toLocaleString()} will be redirected to Stripe (card).`}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Payment Methods Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {language === 'fr' ? 'Méthodes de Paiement' : 'Payment Methods'}
          </CardTitle>
          <CardDescription>
            {language === 'fr' 
              ? 'Activez ou désactivez les méthodes de paiement disponibles' 
              : 'Enable or disable available payment methods'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* pawaPay Mobile Money */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Smartphone className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium">pawaPay (Mobile Money)</p>
                <p className="text-sm text-muted-foreground">
                  {language === 'fr' 
                    ? 'Paiements Mobile Money en RDC' 
                    : 'Mobile Money payments in DRC'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={pawapayEnabled ? 'default' : 'secondary'}>
                {pawapayEnabled 
                  ? (language === 'fr' ? 'Actif' : 'Active') 
                  : (language === 'fr' ? 'Inactif' : 'Inactive')}
              </Badge>
              <Switch 
                checked={pawapayEnabled} 
                onCheckedChange={setPawapayEnabled}
              />
            </div>
          </div>

          {/* Stripe */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <CreditCard className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="font-medium">Stripe</p>
                <p className="text-sm text-muted-foreground">
                  {language === 'fr' 
                    ? 'Paiements par carte (grandes commandes, USD uniquement)' 
                    : 'Card payments (large orders, USD only)'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={stripeEnabled ? 'default' : 'secondary'}>
                {stripeEnabled 
                  ? (language === 'fr' ? 'Actif' : 'Active') 
                  : (language === 'fr' ? 'Inactif' : 'Inactive')}
              </Badge>
              <Switch 
                checked={stripeEnabled} 
                onCheckedChange={setStripeEnabled}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Flow Summary */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle>
            {language === 'fr' ? 'Résumé du Flux de Paiement' : 'Payment Flow Summary'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="mt-0.5">1</Badge>
              <div>
                <p className="font-medium">
                  {language === 'fr' ? 'Commandes standard' : 'Standard orders'}
                </p>
                <p className="text-muted-foreground">
                  {language === 'fr' 
                    ? `≤ $${mobileMoneyMaxUsd.toLocaleString()} USD ou ≤ FC ${mobileMoneyMaxCdf.toLocaleString()} → pawaPay Mobile Money` 
                    : `≤ $${mobileMoneyMaxUsd.toLocaleString()} USD or ≤ FC ${mobileMoneyMaxCdf.toLocaleString()} → pawaPay Mobile Money`}
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="mt-0.5">2</Badge>
              <div>
                <p className="font-medium">
                  {language === 'fr' ? 'Grandes commandes' : 'Large orders'}
                </p>
                <p className="text-muted-foreground">
                  {language === 'fr' 
                    ? `> $${mobileMoneyMaxUsd.toLocaleString()} USD ou > FC ${mobileMoneyMaxCdf.toLocaleString()} → Stripe (carte)` 
                    : `> $${mobileMoneyMaxUsd.toLocaleString()} USD or > FC ${mobileMoneyMaxCdf.toLocaleString()} → Stripe (card)`}
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="mt-0.5">3</Badge>
              <div>
                <p className="font-medium">
                  {language === 'fr' ? 'Véhicules' : 'Vehicles'}
                </p>
                <p className="text-muted-foreground">
                  {language === 'fr' 
                    ? 'Toujours → Stripe (carte)' 
                    : 'Always → Stripe (card)'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
