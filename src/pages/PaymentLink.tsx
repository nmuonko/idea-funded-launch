import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, CreditCard, Building2, Phone, Mail, Copy, Check, ExternalLink, Home, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

type PaymentDecision = 'MAISHAPAY_USD' | 'MAISHAPAY_CDF' | 'MANUAL_BANK';

interface BankDetails {
  bank_name: string;
  account_holder: string;
  account_number: string;
  swift: string;
  iban?: string;
  bank_address?: string;
  instructions_fr: string;
  instructions_en: string;
  support_whatsapp: string;
  support_email: string;
}

interface PaymentLinkData {
  ok: boolean;
  order_id?: string;
  reference_code?: string;
  contains_vehicle?: boolean;
  item_count?: number;
  total_usd?: number;
  fx_rate?: number;
  total_cdf?: number;
  decision?: PaymentDecision;
  reason?: string;
  bank_details?: BankDetails;
  error?: string;
}

// Validate token format before API call
function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  if (token === ':token') return false;
  if (token.length < 16) return false;
  return true;
}

export default function PaymentLink() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PaymentLinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initiating, setInitiating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // Validate token BEFORE calling API
    if (!isValidToken(token)) {
      setError(language === 'fr' 
        ? 'Ce lien de paiement est incomplet ou expiré. Veuillez ouvrir le lien complet reçu par email/SMS.'
        : 'This payment link is incomplete or expired. Please open the full link received by email/SMS.');
      setLoading(false);
      return;
    }

    resolvePaymentLink();
  }, [token, language]);

  const resolvePaymentLink = async () => {
    try {
      const { data: result, error: invokeError } = await supabase.functions.invoke('resolve-payment-link', {
        body: { token },
      });

      // Handle edge function errors gracefully - no throwing
      if (invokeError) {
        console.error('Error resolving payment link:', invokeError);
        setError(language === 'fr'
          ? 'Impossible de charger les détails du paiement. Veuillez réessayer.'
          : 'Unable to load payment details. Please try again.');
        setLoading(false);
        return;
      }

      // Handle API error responses
      if (!result || !result.ok) {
        const errorMessage = result?.error || (language === 'fr'
          ? 'Ce lien de paiement est invalide ou expiré.'
          : 'This payment link is invalid or expired.');
        setError(errorMessage);
        setLoading(false);
        return;
      }

      setData(result);
    } catch (err) {
      // Catch any unexpected errors - never throw to error boundary
      console.error('Exception resolving payment link:', err);
      setError(language === 'fr'
        ? 'Une erreur est survenue. Veuillez réessayer.'
        : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePayWithMaishaPay = async () => {
    if (!token || !data) return;
    
    setInitiating(true);
    try {
      const { data: result, error: invokeError } = await supabase.functions.invoke('initiate-link-payment', {
        body: { 
          token,
          payment_method: 'MOBILE_MONEY',
        },
      });

      // Handle invoke error (network issues, etc.)
      if (invokeError) {
        console.error('Invoke error:', invokeError);
        toast.error(language === 'fr' 
          ? 'Erreur de connexion. Veuillez réessayer.' 
          : 'Connection error. Please try again.');
        return;
      }

      // Handle mode="manual" response (large payment fallback or provider failure)
      if (result?.mode === 'manual' && result?.bank_transfer) {
        // Switch UI to show bank transfer details
        setData({
          ...data,
          decision: 'MANUAL_BANK',
          bank_details: {
            bank_name: result.bank_transfer.bank_name || '',
            account_holder: result.bank_transfer.beneficiary_name || '',
            account_number: result.bank_transfer.iban_or_rib || '',
            swift: result.bank_transfer.swift_or_bic || '',
            iban: result.bank_transfer.iban_or_rib,
            bank_address: result.bank_transfer.bank_address,
            instructions_fr: result.bank_transfer.notes || 'Veuillez inclure la référence dans le libellé du virement.',
            instructions_en: result.bank_transfer.notes || 'Please include the reference in the transfer description.',
            support_whatsapp: data.bank_details?.support_whatsapp || '',
            support_email: data.bank_details?.support_email || '',
          },
          reference_code: result.reference || data.reference_code,
          total_usd: result.amount || data.total_usd,
          total_cdf: result.amount_cdf || data.total_cdf,
        });
        
        // Show informational toast if there was an error
        if (result.error?.code) {
          const errorMessage = result.error.code === 'PROVIDER_LINK_FAILED'
            ? (language === 'fr' 
              ? 'Le paiement mobile n\'est pas disponible. Veuillez utiliser le virement bancaire.'
              : 'Mobile payment is unavailable. Please use bank transfer.')
            : (language === 'fr'
              ? 'Montant élevé - virement bancaire requis.'
              : 'Large amount - bank transfer required.');
          toast.info(errorMessage);
        }
        return;
      }

      // Handle error response without manual fallback
      if (!result?.ok) {
        toast.error(result?.error?.message || result?.error || 
          (language === 'fr' ? 'Échec du paiement' : 'Payment failed'));
        return;
      }

      // Handle mode="redirect" - redirect to payment URL
      if (result.mode === 'redirect' && result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }

      // Legacy support: handle HTML response
      if (result.html) {
        const win = window.open('', '_self');
        if (win) {
          win.document.write(result.html);
          win.document.close();
        }
        return;
      }

      // Legacy support: handle checkout_url
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
        return;
      }

      // Fallback if no action could be taken
      toast.error(language === 'fr' 
        ? 'Réponse inattendue. Veuillez réessayer.' 
        : 'Unexpected response. Please try again.');
    } catch (err) {
      console.error('Exception initiating payment:', err);
      toast.error(language === 'fr' 
        ? 'Une erreur est survenue. Veuillez réessayer.' 
        : 'An error occurred. Please try again.');
    } finally {
      setInitiating(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    toast.success(language === 'fr' ? 'Copié!' : 'Copied!');
    setTimeout(() => setCopied(null), 2000);
  };

  const formatCurrency = (amount: number, currency: 'USD' | 'CDF') => {
    if (currency === 'CDF') {
      return `${amount.toLocaleString('fr-FR')} CDF`;
    }
    return `$${amount.toFixed(2)} USD`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl">
              {language === 'fr' ? 'Lien invalide' : 'Invalid Link'}
            </CardTitle>
            <CardDescription className="mt-2">
              {error}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => navigate('/')} variant="default" className="w-full">
              <Home className="mr-2 h-4 w-4" />
              {language === 'fr' ? 'Retour à l\'accueil' : 'Return Home'}
            </Button>
            <a 
              href="https://wa.me/12025551234" 
              target="_blank" 
              rel="noopener noreferrer"
              className="block"
            >
              <Button variant="outline" className="w-full">
                <MessageCircle className="mr-2 h-4 w-4" />
                {language === 'fr' ? 'Contacter le support' : 'Contact Support'}
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  // Manual Bank Payment UI - Simplified with link to bank details page
  if (data.decision === 'MANUAL_BANK') {
    const bankTransferUrl = `/bank-transfer?ref=${encodeURIComponent(data.reference_code || '')}&amount=${data.total_usd?.toFixed(2) || ''}&amount_cdf=${data.total_cdf || ''}&currency=USD`;

    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Header */}
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <Building2 className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                {language === 'fr' ? 'Paiement par Virement Bancaire' : 'Bank Transfer Payment'}
              </CardTitle>
              <CardDescription>
                {language === 'fr' 
                  ? 'Le montant dépasse les limites de paiement mobile. Veuillez effectuer un virement bancaire.'
                  : 'The amount exceeds mobile payment limits. Please make a bank transfer.'}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Order Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'fr' ? 'Récapitulatif de la commande' : 'Order Summary'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">
                  {language === 'fr' ? 'Référence' : 'Reference'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">{data.reference_code}</span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => copyToClipboard(data.reference_code!, 'ref')}
                  >
                    {copied === 'ref' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {language === 'fr' ? 'Montant USD' : 'Amount USD'}
                </span>
                <span className="font-semibold">${data.total_usd?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {language === 'fr' ? 'Taux de change' : 'Exchange Rate'}
                </span>
                <span>1 USD = {data.fx_rate?.toLocaleString()} CDF</span>
              </div>
              <div className="border-t pt-3 flex justify-between">
                <span className="font-medium">
                  {language === 'fr' ? 'Montant à payer' : 'Amount to Pay'}
                </span>
                <span className="text-xl font-bold text-primary">
                  {data.total_cdf?.toLocaleString('fr-FR')} CDF
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Bank Details Link */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-center text-muted-foreground">
                {language === 'fr' 
                  ? 'Cliquez ci-dessous pour voir les coordonnées bancaires complètes et les instructions.'
                  : 'Click below to see complete bank details and instructions.'}
              </p>
              <Button 
                className="w-full"
                size="lg"
                onClick={() => navigate(bankTransferUrl)}
              >
                <Building2 className="mr-2 h-5 w-5" />
                {language === 'fr' ? 'Voir les coordonnées bancaires' : 'View Full Bank Transfer Details'}
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Important Note */}
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
            <CardContent className="pt-6">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    {language === 'fr' ? 'Important' : 'Important'}
                  </p>
                  <p className="text-amber-700 dark:text-amber-300 mt-1">
                    {language === 'fr' 
                      ? `Incluez la référence "${data.reference_code}" dans le libellé de votre virement.`
                      : `Include reference "${data.reference_code}" in your transfer description.`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // MaishaPay Payment UI (USD or CDF)
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <CreditCard className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">
            {language === 'fr' ? 'Paiement de votre commande' : 'Payment for Your Order'}
          </CardTitle>
          <CardDescription>
            {data.contains_vehicle 
              ? (language === 'fr' ? 'Véhicule - Devis prêt' : 'Vehicle - Quote Ready')
              : (language === 'fr' ? `${data.item_count} article(s)` : `${data.item_count} item(s)`)
            }
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Order Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'Référence' : 'Reference'}
              </span>
              <span className="font-mono">{data.reference_code}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'Total USD' : 'Total USD'}
              </span>
              <span>${data.total_usd?.toFixed(2)}</span>
            </div>
            {data.decision === 'MAISHAPAY_CDF' && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {language === 'fr' ? 'Taux' : 'Rate'}
                  </span>
                  <span>1 USD = {data.fx_rate?.toLocaleString()} CDF</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-medium">
                    {language === 'fr' ? 'À payer' : 'To Pay'}
                  </span>
                  <span className="text-lg font-bold text-primary">
                    {data.total_cdf?.toLocaleString('fr-FR')} CDF
                  </span>
                </div>
              </>
            )}
            {data.decision === 'MAISHAPAY_USD' && (
              <div className="border-t pt-2 flex justify-between">
                <span className="font-medium">
                  {language === 'fr' ? 'À payer' : 'To Pay'}
                </span>
                <span className="text-lg font-bold text-primary">
                  ${data.total_usd?.toFixed(2)} USD
                </span>
              </div>
            )}
          </div>

          {/* Currency Notice for CDF */}
          {data.decision === 'MAISHAPAY_CDF' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm">
              <p className="text-amber-700 dark:text-amber-400">
                {language === 'fr' 
                  ? '💡 Le montant dépasse la limite USD. Paiement en CDF via Mobile Money.'
                  : '💡 Amount exceeds USD limit. Payment in CDF via Mobile Money.'}
              </p>
            </div>
          )}

          {/* Pay Button */}
          <Button 
            className="w-full h-14 text-lg"
            onClick={handlePayWithMaishaPay}
            disabled={initiating}
          >
            {initiating ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                {language === 'fr' ? 'Chargement...' : 'Loading...'}
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-5 w-5" />
                {language === 'fr' ? 'Payer avec MaishaPay' : 'Pay with MaishaPay'}
              </>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            🔒 {language === 'fr' ? 'Paiement sécurisé via MaishaPay' : 'Secure payment via MaishaPay'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Helper component for bank fields
function BankField({ 
  label, 
  value, 
  onCopy, 
  copied 
}: { 
  label: string; 
  value: string; 
  onCopy: () => void; 
  copied: boolean;
}) {
  if (!value) return null;
  
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onCopy}>
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
