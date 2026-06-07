import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Package, Clock, CheckCircle, XCircle, ExternalLink, ArrowLeft, RefreshCw, Truck, ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { getStatusTranslation, getTranslation } from '@/lib/i18n/translations';
import { useShopCart } from '@/contexts/ShopCartContext';

export default function OrderDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { language } = useLanguage();
  const t = getTranslation(language);
  const { addItem } = useShopCart();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [buyingAgain, setBuyingAgain] = useState(false);
  const [payingBalance, setPayingBalance] = useState(false);


  useEffect(() => {
    if (id) {
      loadOrder();
    }
  }, [id]);

  // Auto-open balance payment when arriving from the reminder email link (?pay_balance=1)
  const autoBalanceTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoBalanceTriggeredRef.current) return;
    if (!order) return;
    if (searchParams.get('pay_balance') !== '1') return;
    if (order.payment_plan !== 'deposit' || order.balance_status !== 'pending') return;
    autoBalanceTriggeredRef.current = true;
    void payBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, searchParams]);


  const loadOrder = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate('/auth');
        return;
      }

      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      
      if (!data) {
        toast({
          title: t.common.error,
          description: language === 'fr' ? 'Commande non trouvée' : 'Order not found',
          variant: 'destructive',
        });
        navigate('/orders');
        return;
      }
      
      setOrder(data);
    } catch (error) {
      console.error('Error loading order:', error);
      toast({
        title: t.common.error,
        description: language === 'fr' ? 'Échec du chargement de la commande' : 'Failed to load order',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const retryPayment = async () => {
    if (!order) return;
    try {
      setRetrying(true);
      const { data, error } = await supabase.functions.invoke('payments-core', { body: { action: 'retry', order_id: order.id } });

      if (error) throw error;

      if (data?.payment?.checkoutUrl) {
        window.open(data.payment.checkoutUrl, '_blank');
        toast({
          title: language === 'fr' ? 'Paiement relancé' : 'Payment Retry Initiated',
          description: language === 'fr' ? 'Complétez le paiement dans la nouvelle fenêtre' : 'Complete payment in the new window',
        });
      }
    } catch (error: any) {
      console.error('Error retrying payment:', error);
      toast({
        title: t.common.error,
        description: error.message || (language === 'fr' ? 'Échec de la relance du paiement' : 'Failed to retry payment'),
        variant: 'destructive',
      });
    } finally {
      setRetrying(false);
    }
  };

  const payBalance = async () => {
    if (!order) return;
    try {
      setPayingBalance(true);
      const { data, error } = await supabase.functions.invoke('create-partial-payment', {
        body: { order_id: order.id, kind: 'balance' },
      });
      if (error || !data?.success) {
        const msg = data?.error || error?.message || (language === 'fr' ? 'Échec du paiement du solde' : 'Failed to start balance payment');
        toast({ title: t.common.error, description: msg, variant: 'destructive' });
        return;
      }
      const amount = Number(data.amount || 0);
      if (data.provider === 'stripe' && data.clientSecret) {
        navigate(`/card-payment?order_id=${order.id}&client_secret=${encodeURIComponent(data.clientSecret)}&amount=${amount}&currency=USD&plan=balance`);
        return;
      }
      if (data.provider === 'pawapay') {
        navigate(`/payment-pending?order_id=${order.id}&provider=pawapay&total_usd=${amount}&plan=balance`);
        return;
      }
    } catch (e: any) {
      toast({ title: t.common.error, description: e?.message || 'Failed', variant: 'destructive' });
    } finally {
      setPayingBalance(false);
    }
  };


  const handleBuyAgain = async () => {
    if (!order?.order_items?.length) return;
    
    setBuyingAgain(true);
    try {
      let addedCount = 0;
      
      for (const item of order.order_items) {
        // Only add items with valid product URLs
        if (item.product_url && item.base_price_usd) {
          await addItem({
            productId: item.provider_product_id || item.product_url,
            provider: item.store || 'amazon',
            title: item.title || 'Product',
            imageUrl: item.product_image_url || '',
            priceUsd: item.base_price_usd,
            quantity: item.quantity || 1,
            productUrl: item.product_url,
          });
          addedCount++;
        }
      }
      
      toast({
        title: language === 'fr' ? 'Articles ajoutés' : 'Items Added',
        description: language === 'fr' 
          ? `${addedCount} article(s) ajouté(s) au panier`
          : `${addedCount} item(s) added to cart`,
      });
      
      // Navigate to cart
      navigate('/cart');
    } catch (error: any) {
      console.error('Error adding items to cart:', error);
      toast({
        title: t.common.error,
        description: language === 'fr' ? 'Échec de l\'ajout au panier' : 'Failed to add items to cart',
        variant: 'destructive',
      });
    } finally {
      setBuyingAgain(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusIcons: Record<string, any> = {
      'PENDING_PAYMENT': Clock,
      'PAID': CheckCircle,
      'PROCESSING': Package,
      'SHIPPED': Truck,
      'READY_FOR_PICKUP': Package,
      'COMPLETED': CheckCircle,
      'CANCELLED': XCircle,
    };

    const statusColors: Record<string, string> = {
      'PENDING_PAYMENT': 'bg-yellow-500',
      'PAID': 'bg-green-500',
      'PROCESSING': 'bg-blue-500',
      'SHIPPED': 'bg-purple-500',
      'READY_FOR_PICKUP': 'bg-indigo-500',
      'COMPLETED': 'bg-emerald-500',
      'CANCELLED': 'bg-red-500',
    };

    const Icon = statusIcons[status] || Clock;
    const colorClass = statusColors[status] || 'bg-gray-500';
    const label = getStatusTranslation(status, language);

    return (
      <Badge className={`${colorClass}`}>
        <Icon className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              {language === 'fr' ? 'Commande non trouvée' : 'Order not found'}
            </h3>
            <Button onClick={() => navigate('/orders')} variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {language === 'fr' ? 'Retour aux commandes' : 'Back to orders'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <Button 
        onClick={() => navigate('/orders')} 
        variant="ghost" 
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {language === 'fr' ? 'Retour aux commandes' : 'Back to orders'}
      </Button>

      <div className="space-y-6">
        {/* Order Header */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <CardTitle className="text-2xl">
                  {language === 'fr' ? 'Commande' : 'Order'} #{order.id.slice(0, 8)}
                </CardTitle>
                <CardDescription>
                  {language === 'fr' ? 'Passée le' : 'Placed on'} {new Date(order.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(order.status)}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Order Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {language === 'fr' ? 'Résumé de la commande' : 'Order Summary'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {language === 'fr' ? 'Sous-total articles' : 'Items Subtotal'}
                </span>
                <span>${Number(order.item_total_usd || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {language === 'fr' ? 'Frais de service' : 'Service Fee'}
                </span>
                <span>${Number(order.service_fee_usd || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {language === 'fr' ? 'Frais de livraison' : 'Shipping Fee'}
                </span>
                <span>${Number(order.shipping_fee_usd || 0).toFixed(2)}</span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between font-semibold text-lg">
                  <span>Total USD</span>
                  <span>${Number(order.total_usd || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total CDF</span>
                  <span>{Number(order.total_cdf || 0).toLocaleString()} CDF</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tracking Info */}
        {order.tracking_number && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'fr' ? 'Suivi de livraison' : 'Shipping Tracking'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {language === 'fr' ? 'Numéro de suivi' : 'Tracking Number'}
                  </span>
                  <span className="font-mono">{order.tracking_number}</span>
                </div>
                {order.carrier && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {language === 'fr' ? 'Transporteur' : 'Carrier'}
                    </span>
                    <span>{order.carrier}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Order Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {language === 'fr' ? 'Articles commandés' : 'Order Items'} ({order.order_items?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {order.order_items?.map((item: any) => (
                <div key={item.id} className="flex gap-4 p-3 bg-muted/50 rounded-lg">
                  {item.product_image_url && (
                    <img 
                      src={item.product_image_url} 
                      alt="" 
                      className="h-20 w-20 object-cover rounded"
                      onError={(e) => e.currentTarget.style.display = 'none'}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium line-clamp-2">{item.title || 'Product'}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {language === 'fr' ? 'Quantité:' : 'Quantity:'} {item.quantity}
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      ${Number(item.total_price_usd || item.base_price_usd || 0).toFixed(2)}
                    </p>
                    {item.shipping_status && (
                      <Badge variant="outline" className="mt-2 text-xs">
                        {getStatusTranslation(item.shipping_status.toUpperCase(), language)}
                      </Badge>
                    )}
                  </div>
                  {item.product_url && (
                    <Button variant="ghost" size="sm" asChild className="flex-shrink-0">
                      <a href={item.product_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Deposit / balance card */}
        {order.payment_plan === 'deposit' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'fr' ? 'Plan d\'acompte 30% / 70%' : '30% / 70% Deposit Plan'}
              </CardTitle>
              <CardDescription>
                {order.balance_status === 'paid'
                  ? (language === 'fr' ? 'Solde réglé.' : 'Balance fully paid.')
                  : (language === 'fr' ? 'Votre acompte est payé. Le solde est dû à l\'arrivée.' : 'Your deposit is paid. The balance is due on arrival.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === 'fr' ? 'Acompte payé (30%)' : 'Deposit paid (30%)'}</span>
                  <span className="font-medium text-green-600">${Number(order.deposit_amount_usd || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === 'fr' ? 'Solde (70%)' : 'Balance (70%)'}</span>
                  <span className="font-medium">${Number(order.balance_amount_usd || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span>{language === 'fr' ? 'Statut du solde' : 'Balance status'}</span>
                  <Badge className={order.balance_status === 'paid' ? 'bg-green-500' : 'bg-amber-500'}>
                    {order.balance_status === 'paid'
                      ? (language === 'fr' ? 'Payé' : 'Paid')
                      : (language === 'fr' ? 'En attente' : 'Pending')}
                  </Badge>
                </div>
                {order.balance_status === 'pending' && (
                  <Button
                    onClick={payBalance}
                    disabled={payingBalance}
                    className="w-full mt-4 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
                  >
                    {payingBalance ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{language === 'fr' ? 'Préparation…' : 'Preparing…'}</>
                    ) : (
                      <>{language === 'fr' ? `Payer le solde ($${Number(order.balance_amount_usd || 0).toFixed(2)})` : `Pay balance ($${Number(order.balance_amount_usd || 0).toFixed(2)})`}</>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}



        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          {/* Buy Again - show for completed/delivered orders */}
          {['DELIVERED', 'COMPLETED', 'PAID', 'SHIPPED'].includes(order.status) && order.order_items?.length > 0 && (
            <Button
              onClick={handleBuyAgain}
              disabled={buyingAgain}
              className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
            >
              {buyingAgain ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {language === 'fr' ? 'Ajout...' : 'Adding...'}
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  {language === 'fr' ? 'Acheter à nouveau' : 'Buy Again'}
                </>
              )}
            </Button>
          )}
          
          {order.status === 'PENDING_PAYMENT' && (
            <Button 
              onClick={retryPayment}
              disabled={retrying}
            >
              {retrying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {language === 'fr' ? 'Traitement...' : 'Processing...'}
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {language === 'fr' ? 'Réessayer le paiement' : 'Retry Payment'}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}