import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Clock, AlertTriangle, Loader2, Copy, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * MaishaPay Result Page
 * 
 * This is the callback URL that MaishaPay redirects users to after payment.
 * URL: /maishapay/result?status=...&description=...&transactionRefId=...&operatorRefId=...
 * 
 * Status codes from MaishaPay:
 * - 202: Payment accepted/successful
 * - 201: Payment pending
 * - Other: Failed or cancelled
 */

type PaymentState = 'loading' | 'success' | 'pending' | 'failed' | 'error';

interface PaymentData {
  orderId?: string;
  totalUsd?: number;
  totalCdf?: number;
  transactionRefId?: string;
  operatorRefId?: string;
  statusCode?: string;
  description?: string;
  confirmationCode?: string;
}

export default function MaishapayResult() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, setState] = useState<PaymentState>('loading');
  const [orderData, setOrderData] = useState<PaymentData>({});
  const [copied, setCopied] = useState(false);

  const copyConfirmationCode = async () => {
    if (orderData.confirmationCode) {
      await navigator.clipboard.writeText(orderData.confirmationCode);
      setCopied(true);
      toast({
        title: "Copié!",
        description: "Le numéro de confirmation a été copié.",
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    const processCallback = async () => {
      // Read query params from MaishaPay redirect
      const status = searchParams.get('status');
      const description = searchParams.get('description') || 'No description provided';
      const transactionRefId = searchParams.get('transactionRefId') || searchParams.get('reference');
      const operatorRefId = searchParams.get('operatorRefId') || '';
      const orderId = searchParams.get('orderId') || searchParams.get('order_id');

      console.log('[MaishapayResult] Query params:', { status, description, transactionRefId, operatorRefId, orderId });

      // Store for display
      setOrderData({
        transactionRefId: transactionRefId || undefined,
        operatorRefId: operatorRefId || undefined,
        statusCode: status || undefined,
        description,
      });

      // If no transaction ref and no order id, show error
      if (!transactionRefId && !orderId) {
        setState('error');
        return;
      }

      try {
        // Call edge function to process payment result
        const { data, error } = await supabase.functions.invoke('maishapay-process-result', {
          body: {
            status: status ? parseInt(status) : null,
            description,
            transactionRefId,
            operatorRefId,
            orderId,
            rawQuery: Object.fromEntries(searchParams.entries()),
          },
        });

        console.log('[MaishapayResult] Backend response:', { data, error });

        if (error) {
          console.error('[MaishapayResult] Backend error:', error);
          
          // Still show status based on MaishaPay response even if backend update failed
          if (status === '202') {
            setState('success');
          } else {
            setState('failed');
          }
          return;
        }

        if (data) {
          setOrderData(prev => ({
            ...prev,
            orderId: data.orderId,
            totalUsd: data.amountUsd,
            totalCdf: data.amountCdf,
            confirmationCode: data.confirmationCode,
            description: data.description || prev.description,
          }));

          if (data.status === 'SUCCESS') {
            setState('success');
          } else if (data.status === 'PENDING') {
            setState('pending');
          } else if (data.status === 'CANCELLED') {
            setState('failed');
          } else {
            setState('failed');
          }

          // Handle case where order wasn't found
          if (data.error === 'ORDER_NOT_FOUND') {
            setState('error');
            toast({
              title: "Commande non trouvée",
              description: "Nous n'avons pas pu trouver votre commande. Veuillez contacter le support.",
              variant: "destructive",
            });
          }
        } else {
          // Fallback to status code interpretation
          if (status === '202') {
            setState('success');
          } else {
            setState('failed');
          }
        }
      } catch (err) {
        console.error('[MaishapayResult] Processing error:', err);
        // Still try to show status based on MaishaPay response
        if (status === '202') {
          setState('success');
        } else {
          setState('failed');
        }
      }
    };

    processCallback();
  }, [searchParams, toast]);

  const renderConfirmationBox = () => {
    if (!orderData.confirmationCode) return null;
    
    return (
      <div className="bg-primary/10 border-2 border-primary rounded-xl p-6 mb-6">
        <p className="text-sm text-muted-foreground mb-2">Numéro de confirmation</p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-2xl font-bold font-mono tracking-wider text-primary">
            {orderData.confirmationCode}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={copyConfirmationCode}
            className="h-8 w-8"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Veuillez conserver ce numéro pour le suivi de votre commande.
        </p>
      </div>
    );
  };

  const renderContent = () => {
    switch (state) {
      case 'loading':
        return (
          <>
            <Loader2 className="h-16 w-16 text-primary animate-spin mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Vérification du paiement en cours…</h1>
            <p className="text-sm text-muted-foreground">Verifying payment</p>
            <p className="text-muted-foreground mb-6 mt-4">
              Veuillez patienter pendant que nous confirmons votre paiement...
            </p>
          </>
        );

      case 'success':
        return (
          <>
            <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-1 text-green-600">Paiement réussi</h1>
            <p className="text-sm text-muted-foreground mb-6">Payment successful</p>
            
            <p className="text-muted-foreground mb-6">
              Merci ! Votre paiement a été reçu.
            </p>

            {renderConfirmationBox()}

            {(orderData.totalUsd || orderData.totalCdf) && (
              <div className="bg-muted p-4 rounded-lg mb-6 text-left">
                <p className="text-sm font-semibold mb-2">Récapitulatif</p>
                {orderData.totalUsd && (
                  <p className="text-sm">Montant (USD): <span className="font-semibold">${orderData.totalUsd.toFixed(2)}</span></p>
                )}
                {orderData.totalCdf && (
                  <p className="text-sm">Montant (CDF): <span className="font-semibold">{orderData.totalCdf.toLocaleString()} FC</span></p>
                )}
              </div>
            )}

            <div className="bg-muted/50 p-3 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-medium">Réf. Transaction:</span> {orderData.transactionRefId}</p>
              )}
              {orderData.operatorRefId && (
                <p><span className="font-medium">Réf. Opérateur:</span> {orderData.operatorRefId}</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                Voir mes commandes
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Retour à l'accueil
              </Button>
            </div>
          </>
        );

      case 'pending':
        return (
          <>
            <Clock className="h-20 w-20 text-orange-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-1 text-orange-600">Paiement en cours</h1>
            <p className="text-sm text-muted-foreground mb-6">Payment pending</p>

            <p className="text-muted-foreground mb-6">
              Votre paiement est en cours de traitement. Cela peut prendre quelques instants.
            </p>

            <div className="bg-muted/50 p-3 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-medium">Réf. Transaction:</span> {orderData.transactionRefId}</p>
              )}
              {orderData.operatorRefId && (
                <p><span className="font-medium">Réf. Opérateur:</span> {orderData.operatorRefId}</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                Vérifier le statut
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Retour à l'accueil
              </Button>
            </div>
          </>
        );

      case 'failed':
        return (
          <>
            <XCircle className="h-20 w-20 text-destructive mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-1 text-destructive">Paiement échoué</h1>
            <p className="text-sm text-muted-foreground mb-6">Payment failed</p>

            <p className="text-muted-foreground mb-6">
              {orderData.description || 'Votre paiement n\'a pas pu être traité ou a été annulé.'}
            </p>

            <div className="bg-muted/50 p-3 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-medium">Réf. Transaction:</span> {orderData.transactionRefId}</p>
              )}
              {orderData.statusCode && (
                <p><span className="font-medium">Code statut:</span> {orderData.statusCode}</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                Réessayer le paiement
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Retour à l'accueil
              </Button>
            </div>
          </>
        );

      case 'error':
        return (
          <>
            <AlertTriangle className="h-20 w-20 text-destructive mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-1 text-destructive">Impossible de vérifier</h1>
            <p className="text-sm text-muted-foreground mb-6">Unable to verify payment</p>

            <p className="text-muted-foreground mb-6">
              Nous n'avons pas pu identifier votre commande. Si vous pensez avoir été débité, 
              veuillez contacter le support avec votre référence de transaction.
            </p>

            <div className="bg-muted/50 p-3 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-medium">Réf. Transaction:</span> {orderData.transactionRefId}</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/support')} className="flex-1">
                Contacter le support
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Retour à l'accueil
              </Button>
            </div>
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center">
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
