import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, CreditCard, Building2, Phone, Mail, Copy, Check, ExternalLink } from 'lucide-react';
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
    if (!token) {
      setError('Invalid payment link');
      setLoading(false);
      return;
    }

    resolvePaymentLink();
  }, [token]);

  const resolvePaymentLink = async () => {
    try {
      const { data: result, error: invokeError } = await supabase.functions.invoke('resolve-payment-link', {
        body: { token },
      });

      if (invokeError) {
        console.error('Error resolving payment link:', invokeError);
        setError('Unable to load payment details. Please try again.');
        return;
      }

      if (!result.ok) {
        setError(result.error || 'Payment link is invalid or expired');
        return;
      }

      setData(result);
    } catch (err) {
      console.error('Exception resolving payment link:', err);
      setError('An error occurred. Please try again.');
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

      if (invokeError || !result.success) {
        toast.error(result?.error || 'Failed to initiate payment');
        return;
      }

      // If we have HTML, render it in a new window or navigate
      if (result.html) {
        // Open MaishaPay checkout
        const win = window.open('', '_self');
        if (win) {
          win.document.write(result.html);
          win.document.close();
        }
      } else if (result.checkout_url) {
        window.location.href = result.checkout_url;
      }
    } catch (err) {
      console.error('Exception initiating payment:', err);
      toast.error('An error occurred. Please try again.');
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
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-6 w-6" />
              <CardTitle>{language === 'fr' ? 'Lien invalide' : 'Invalid Link'}</CardTitle>
            </div>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/')} variant="outline" className="w-full">
              {language === 'fr' ? 'Retour à l\'accueil' : 'Return Home'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  // Manual Bank Payment UI
  if (data.decision === 'MANUAL_BANK' && data.bank_details) {
    const instructions = language === 'fr' 
      ? data.bank_details.instructions_fr 
      : data.bank_details.instructions_en;

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
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {language === 'fr' ? 'Référence' : 'Reference'}
                </span>
                <span className="font-mono font-medium">{data.reference_code}</span>
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

          {/* Bank Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'fr' ? 'Coordonnées bancaires' : 'Bank Details'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <BankField 
                label={language === 'fr' ? 'Banque' : 'Bank'}
                value={data.bank_details.bank_name}
                onCopy={() => copyToClipboard(data.bank_details!.bank_name, 'bank')}
                copied={copied === 'bank'}
              />
              <BankField 
                label={language === 'fr' ? 'Titulaire' : 'Account Holder'}
                value={data.bank_details.account_holder}
                onCopy={() => copyToClipboard(data.bank_details!.account_holder, 'holder')}
                copied={copied === 'holder'}
              />
              <BankField 
                label={language === 'fr' ? 'Numéro de compte' : 'Account Number'}
                value={data.bank_details.account_number}
                onCopy={() => copyToClipboard(data.bank_details!.account_number, 'account')}
                copied={copied === 'account'}
              />
              <BankField 
                label="SWIFT/BIC"
                value={data.bank_details.swift}
                onCopy={() => copyToClipboard(data.bank_details!.swift, 'swift')}
                copied={copied === 'swift'}
              />
              {data.bank_details.iban && (
                <BankField 
                  label="IBAN"
                  value={data.bank_details.iban}
                  onCopy={() => copyToClipboard(data.bank_details!.iban!, 'iban')}
                  copied={copied === 'iban'}
                />
              )}
              {data.bank_details.bank_address && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    {language === 'fr' ? 'Adresse de la banque' : 'Bank Address'}
                  </p>
                  <p className="text-sm">{data.bank_details.bank_address}</p>
                </div>
              )}

              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mt-4">
                <p className="text-sm font-medium text-primary mb-2">
                  ⚠️ {language === 'fr' ? 'Référence de paiement obligatoire' : 'Required Payment Reference'}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-background rounded px-3 py-2 font-mono text-sm">
                    {data.reference_code}
                  </code>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => copyToClipboard(data.reference_code!, 'ref')}
                  >
                    {copied === 'ref' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'fr' ? 'Instructions' : 'Instructions'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{instructions}</p>
            </CardContent>
          </Card>

          {/* Support Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'fr' ? 'Envoyer la preuve de paiement' : 'Send Payment Proof'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <a 
                href={`https://wa.me/${data.bank_details.support_whatsapp.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors"
              >
                <Phone className="h-5 w-5 text-green-600" />
                <span className="flex-1">WhatsApp: {data.bank_details.support_whatsapp}</span>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
              <a 
                href={`mailto:${data.bank_details.support_email}?subject=Payment Proof - ${data.reference_code}`}
                className="flex items-center gap-3 p-3 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors"
              >
                <Mail className="h-5 w-5 text-blue-600" />
                <span className="flex-1">{data.bank_details.support_email}</span>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
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
