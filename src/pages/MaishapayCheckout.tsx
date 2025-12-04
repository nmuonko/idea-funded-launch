import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/**
 * MaishaPay Checkout Page
 * 
 * This page renders an auto-submitting HTML form that POSTs to MaishaPay's checkout endpoint.
 * MaishaPay requires form POST submission - not a JSON API call.
 * 
 * Flow:
 * 1. Mobile app calls /mobile-checkout to create order
 * 2. Mobile app receives redirectUrl pointing here with orderId
 * 3. This page fetches order details and MaishaPay config
 * 4. Page renders hidden form and auto-submits to MaishaPay
 * 5. User completes payment on MaishaPay
 * 6. MaishaPay redirects user to /maishapay/result with status params
 */

// MaishaPay checkout form URL (constant)
const MAISHAPAY_CHECKOUT_URL = "https://marchand.maishapay.online/payment/vers1.0/merchant/checkout";

interface MaishapayConfig {
  gatewayMode: string;
  publicApiKey: string;
  secretApiKey: string;
  callbackUrl: string;
}

export default function MaishapayCheckout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<{
    orderId: string;
    amount: number;
    currency: string;
    reference: string;
  } | null>(null);
  const [config, setConfig] = useState<MaishapayConfig | null>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);

  // Get orderId from URL params
  const orderId = searchParams.get('orderId') || searchParams.get('order_id');

  console.log('[MaishapayCheckout] Page loaded with orderId:', orderId);

  useEffect(() => {
    const loadOrderAndConfig = async () => {
      console.log('[MaishapayCheckout] Starting to load order and config...');
      
      if (!orderId) {
        console.error('[MaishapayCheckout] Missing orderId in URL');
        setError("Commande introuvable. ID de commande manquant.");
        setLoading(false);
        return;
      }

      try {
        // Fetch order data from Supabase
        console.log('[MaishapayCheckout] Fetching order:', orderId);
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select('id, total_usd, maisha_transaction_id, status')
          .eq('id', orderId)
          .maybeSingle();

        if (orderError) {
          console.error('[MaishapayCheckout] Order fetch error:', orderError);
          setError("Erreur lors de la récupération de la commande. Veuillez réessayer.");
          setLoading(false);
          return;
        }

        if (!order) {
          console.error('[MaishapayCheckout] Order not found:', orderId);
          setError("Commande introuvable. Veuillez contacter le support.");
          setLoading(false);
          return;
        }

        console.log('[MaishapayCheckout] Order found:', { id: order.id, status: order.status, total_usd: order.total_usd });

        // Allow PENDING_PAYMENT or DRAFT orders to proceed
        if (order.status !== 'PENDING_PAYMENT' && order.status !== 'DRAFT') {
          console.warn('[MaishapayCheckout] Invalid order status:', order.status);
          setError(`Cette commande ne peut pas être payée. Statut: ${order.status}`);
          setLoading(false);
          return;
        }

        // Fetch MaishaPay configuration from edge function
        console.log('[MaishapayCheckout] Fetching MaishaPay config...');
        const { data: configData, error: configError } = await supabase.functions.invoke('maishapay-get-config');

        if (configError) {
          console.error('[MaishapayCheckout] Config fetch error:', configError);
          setError("Erreur de configuration du paiement. Veuillez contacter le support.");
          setLoading(false);
          return;
        }

        if (!configData?.success) {
          console.error('[MaishapayCheckout] Config not successful:', configData?.error);
          setError("Configuration du paiement invalide. Veuillez contacter le support.");
          setLoading(false);
          return;
        }

        console.log('[MaishapayCheckout] Config received:', { 
          mode: configData.mode, 
          hasPublicKey: !!configData.publicApiKey,
          callbackUrl: configData.callbackUrl 
        });

        // Generate reference if not exists
        const reference = order.maisha_transaction_id || `AFRISHOP-${orderId.slice(0, 8)}-${Date.now().toString(36)}`;

        // Update order with reference if it was generated
        if (!order.maisha_transaction_id) {
          console.log('[MaishapayCheckout] Updating order with transaction reference:', reference);
          await supabase
            .from('orders')
            .update({ maisha_transaction_id: reference })
            .eq('id', orderId);
        }

        setOrderData({
          orderId: order.id,
          amount: order.total_usd || 0,
          currency: 'USD',
          reference,
        });

        setConfig({
          gatewayMode: configData.gatewayMode,
          publicApiKey: configData.publicApiKey,
          secretApiKey: configData.secretApiKey,
          callbackUrl: configData.callbackUrl,
        });

        console.log('[MaishapayCheckout] Ready to submit form');
        setLoading(false);

      } catch (err) {
        console.error('[MaishapayCheckout] Unexpected error:', err);
        setError("Une erreur inattendue s'est produite. Veuillez réessayer.");
        setLoading(false);
      }
    };

    loadOrderAndConfig();
  }, [orderId]);

  // Auto-submit form when data is ready
  useEffect(() => {
    if (!loading && orderData && config && !error && !formSubmitted && formRef.current) {
      console.log('[MaishapayCheckout] Auto-submitting form to MaishaPay:', MAISHAPAY_CHECKOUT_URL);
      console.log('[MaishapayCheckout] Form data:', {
        gatewayMode: config.gatewayMode,
        amount: orderData.amount,
        currency: orderData.currency,
        reference: orderData.reference,
        callbackUrl: config.callbackUrl,
      });
      
      setFormSubmitted(true);
      // Small delay to ensure form is rendered
      setTimeout(() => {
        if (formRef.current) {
          formRef.current.submit();
        }
      }, 300);
    }
  }, [loading, orderData, config, error, formSubmitted]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Préparation du paiement</h1>
            <p className="text-sm text-muted-foreground mb-1">Preparing payment</p>
            <p className="text-muted-foreground mt-4">
              Redirection vers MaishaPay, veuillez patienter...
            </p>
            {orderId && (
              <p className="text-xs text-muted-foreground mt-2">
                Commande: {orderId.slice(0, 8)}...
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2 text-destructive">Erreur de paiement</h1>
            <p className="text-sm text-muted-foreground mb-1">Payment error</p>
            <p className="text-muted-foreground mb-6 mt-4">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                Voir mes commandes
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Retour à l'accueil
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Missing data - should not happen but handle gracefully
  if (!orderData || !config) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Chargement...</h1>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Ready to submit form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Redirection vers MaishaPay</h1>
          <p className="text-sm text-muted-foreground mb-1">Redirecting to MaishaPay</p>
          <p className="text-muted-foreground my-4">
            Montant: ${orderData.amount.toFixed(2)} {orderData.currency}
          </p>
          <p className="text-sm text-muted-foreground">
            Si vous n'êtes pas redirigé automatiquement, cliquez sur le bouton ci-dessous.
          </p>

          {/* MaishaPay Checkout Form - exactly as per documentation */}
          <form
            ref={formRef}
            id="maishapayCheckoutForm"
            action={MAISHAPAY_CHECKOUT_URL}
            method="POST"
            className="mt-4"
          >
            <input type="hidden" name="gatewayMode" value={config.gatewayMode} />
            <input type="hidden" name="publicApiKey" value={config.publicApiKey} />
            <input type="hidden" name="secretApiKey" value={config.secretApiKey} />
            <input type="hidden" name="montant" value={orderData.amount.toFixed(2)} />
            <input type="hidden" name="devise" value={orderData.currency} />
            <input type="hidden" name="callbackUrl" value={config.callbackUrl} />
            <input type="hidden" name="reference" value={orderData.reference} />
            
            <noscript>
              <button type="submit" className="w-full bg-primary text-primary-foreground px-4 py-2 rounded">
                Payer avec MaishaPay
              </button>
            </noscript>
            
            <Button type="submit" variant="outline" className="w-full mt-4">
              Cliquez ici si non redirigé
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-4">
            Réf: {orderData.reference}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
