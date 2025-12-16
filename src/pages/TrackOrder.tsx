import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search, Package, CheckCircle, Clock, Truck, MapPin, AlertTriangle, ArrowLeft, Copy, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface OrderData {
  id: string;
  status: string;
  total_usd: number;
  total_cdf: number;
  created_at: string;
  shipped_at?: string;
  delivered_at?: string;
  estimated_delivery?: string;
  tracking_number?: string;
  carrier?: string;
  shipping_city?: string;
  order_items: Array<{
    id: string;
    title: string;
    quantity: number;
    base_price_usd: number;
    product_image_url?: string;
  }>;
  confirmationCode?: string;
}

const statusConfig: Record<string, { label: string; labelFr: string; color: string; icon: any }> = {
  DRAFT: { label: "Draft", labelFr: "Brouillon", color: "bg-gray-500", icon: Package },
  PENDING_PAYMENT: { label: "Pending Payment", labelFr: "En attente de paiement", color: "bg-yellow-500", icon: Clock },
  PAID: { label: "Paid", labelFr: "Payé", color: "bg-green-500", icon: CheckCircle },
  PROCESSING: { label: "Processing", labelFr: "En traitement", color: "bg-blue-500", icon: Package },
  SHIPPED: { label: "Shipped", labelFr: "Expédié", color: "bg-purple-500", icon: Truck },
  READY_FOR_PICKUP: { label: "Ready for Pickup", labelFr: "Prêt à retirer", color: "bg-cyan-500", icon: MapPin },
  COMPLETED: { label: "Completed", labelFr: "Livré", color: "bg-emerald-500", icon: CheckCircle },
  CANCELLED: { label: "Cancelled", labelFr: "Annulé", color: "bg-red-500", icon: AlertTriangle },
};

export default function TrackOrder() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [confirmationCode, setConfirmationCode] = useState(searchParams.get("code") || "");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-search if code is in URL
  useEffect(() => {
    const codeFromUrl = searchParams.get("code");
    if (codeFromUrl) {
      setConfirmationCode(codeFromUrl);
      handleSearch(codeFromUrl);
    }
  }, [searchParams]);

  const handleSearch = async (code?: string) => {
    const searchCode = (code || confirmationCode).trim().toUpperCase();
    
    if (!searchCode) {
      toast({
        title: "Code requis",
        description: "Veuillez entrer un numéro de confirmation.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setSearched(true);
    setError(null);
    setOrderData(null);

    try {
      // Find payment by confirmation code using safe view (excludes sensitive raw API data)
      const { data: payment, error: paymentError } = await supabase
        .from("safe_user_payments")
        .select("order_id, confirmation_code")
        .eq("confirmation_code", searchCode)
        .maybeSingle();

      if (paymentError) {
        console.error("Payment lookup error:", paymentError);
        throw new Error("Erreur lors de la recherche");
      }

      if (!payment) {
        setError("Aucune commande trouvée avec ce numéro de confirmation.");
        return;
      }

      // Get order details
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select(`
          id,
          status,
          total_usd,
          total_cdf,
          created_at,
          shipped_at,
          delivered_at,
          estimated_delivery,
          tracking_number,
          carrier,
          shipping_city,
          order_items (
            id,
            title,
            quantity,
            base_price_usd,
            product_image_url
          )
        `)
        .eq("id", payment.order_id)
        .single();

      if (orderError || !order) {
        setError("Commande non trouvée.");
        return;
      }

      setOrderData({
        ...order,
        confirmationCode: payment.confirmation_code,
      });
    } catch (err: any) {
      console.error("Search error:", err);
      setError(err.message || "Une erreur s'est produite.");
    } finally {
      setLoading(false);
    }
  };

  const copyTrackingNumber = async () => {
    if (orderData?.tracking_number) {
      await navigator.clipboard.writeText(orderData.tracking_number);
      setCopied(true);
      toast({ title: "Copié!", description: "Numéro de suivi copié." });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusInfo = (status: string) => {
    return statusConfig[status] || statusConfig.DRAFT;
  };

  const getStatusSteps = (currentStatus: string) => {
    const steps = ["PAID", "PROCESSING", "SHIPPED", "COMPLETED"];
    const currentIndex = steps.indexOf(currentStatus);
    
    return steps.map((step, index) => ({
      ...statusConfig[step],
      status: step,
      completed: index <= currentIndex,
      current: index === currentIndex,
    }));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground py-12 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="absolute top-4 left-4 text-primary-foreground hover:bg-primary-foreground/10"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Accueil
          </Button>
          
          <Package className="h-12 w-12 mx-auto mb-4 opacity-90" />
          <h1 className="text-3xl font-bold mb-2">Suivi de commande</h1>
          <p className="text-primary-foreground/80">Track your order</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-8">
        {/* Search Card */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">Entrez votre numéro de confirmation</CardTitle>
            <CardDescription>Enter your confirmation number</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: AFS-XXXX-XXXX"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="font-mono text-lg tracking-wider"
              />
              <Button onClick={() => handleSearch()} disabled={loading}>
                {loading ? (
                  <span className="animate-spin">⏳</span>
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {searched && !loading && (
          <div className="mt-6">
            {error ? (
              <Card className="border-destructive/50">
                <CardContent className="pt-6 text-center">
                  <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Commande non trouvée</h3>
                  <p className="text-muted-foreground">{error}</p>
                  <p className="text-sm text-muted-foreground mt-4">
                    Vérifiez le numéro de confirmation et réessayez.<br/>
                    Check your confirmation number and try again.
                  </p>
                </CardContent>
              </Card>
            ) : orderData ? (
              <div className="space-y-6">
                {/* Order Status Card */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Badge className={`${getStatusInfo(orderData.status).color} text-white`}>
                            {getStatusInfo(orderData.status).labelFr}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {getStatusInfo(orderData.status).label}
                        </CardDescription>
                      </div>
                      {orderData.confirmationCode && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Confirmation</p>
                          <p className="font-mono font-bold text-primary">
                            {orderData.confirmationCode}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Progress Steps */}
                    {["PAID", "PROCESSING", "SHIPPED", "COMPLETED"].includes(orderData.status) && (
                      <div className="mb-6">
                        <div className="flex justify-between mb-2">
                          {getStatusSteps(orderData.status).map((step, index) => (
                            <div key={step.status} className="flex flex-col items-center flex-1">
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                  step.completed
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                <step.icon className="h-4 w-4" />
                              </div>
                              <span className={`text-xs mt-1 text-center ${step.current ? "font-semibold" : ""}`}>
                                {step.labelFr}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex">
                          {getStatusSteps(orderData.status).map((step, index) => (
                            <div
                              key={`line-${index}`}
                              className={`flex-1 h-1 ${index === 0 ? "" : ""} ${
                                step.completed ? "bg-primary" : "bg-muted"
                              } ${index === 3 ? "hidden" : ""}`}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tracking Info */}
                    {orderData.tracking_number && (
                      <div className="bg-muted/50 p-4 rounded-lg mb-4">
                        <p className="text-sm text-muted-foreground mb-1">
                          Numéro de suivi / Tracking Number
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">
                            {orderData.tracking_number}
                          </span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyTrackingNumber}>
                            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                        {orderData.carrier && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Transporteur: {orderData.carrier}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Date de commande</p>
                        <p className="font-medium">
                          {new Date(orderData.created_at).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      {orderData.shipped_at && (
                        <div>
                          <p className="text-muted-foreground">Date d'expédition</p>
                          <p className="font-medium">
                            {new Date(orderData.shipped_at).toLocaleDateString("fr-FR")}
                          </p>
                        </div>
                      )}
                      {orderData.estimated_delivery && (
                        <div>
                          <p className="text-muted-foreground">Livraison estimée</p>
                          <p className="font-medium">
                            {new Date(orderData.estimated_delivery).toLocaleDateString("fr-FR")}
                          </p>
                        </div>
                      )}
                      {orderData.delivered_at && (
                        <div>
                          <p className="text-muted-foreground">Date de livraison</p>
                          <p className="font-medium text-green-600">
                            {new Date(orderData.delivered_at).toLocaleDateString("fr-FR")}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Order Items Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Articles commandés</CardTitle>
                    <CardDescription>Order items</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {orderData.order_items.map((item) => (
                        <div key={item.id} className="flex gap-4">
                          {item.product_image_url ? (
                            <img
                              src={item.product_image_url}
                              alt={item.title}
                              className="w-16 h-16 object-cover rounded-lg bg-muted"
                            />
                          ) : (
                            <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center">
                              <Package className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="font-medium line-clamp-2">{item.title || "Product"}</p>
                            <p className="text-sm text-muted-foreground">Quantité: {item.quantity}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">
                              ${(Number(item.base_price_usd) * item.quantity).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <Separator className="my-4" />

                    <div className="flex justify-between items-center">
                      <span className="font-semibold">Total</span>
                      <div className="text-right">
                        <p className="font-bold text-lg">${Number(orderData.total_usd).toFixed(2)}</p>
                        <p className="text-sm text-muted-foreground">
                          {Number(orderData.total_cdf).toLocaleString()} CDF
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Support */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-muted-foreground mb-4">
                        Besoin d'aide avec votre commande?<br/>
                        <span className="text-sm">Need help with your order?</span>
                      </p>
                      <Button variant="outline" onClick={() => navigate("/support")}>
                        Contacter le support
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        )}

        {/* Initial State */}
        {!searched && (
          <div className="mt-8 text-center text-muted-foreground">
            <Package className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p>Entrez votre numéro de confirmation pour voir le statut de votre commande.</p>
            <p className="text-sm mt-2">Enter your confirmation number to see your order status.</p>
          </div>
        )}
      </div>

      {/* Footer spacing */}
      <div className="h-16" />
    </div>
  );
}
