import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Car, ExternalLink, Clock, Send, DollarSign, Loader2, RefreshCw, Store } from "lucide-react";
import { formatCurrency, type SupportedLocale } from "@/lib/formatCurrency";

// Auto-refresh interval: 5 minutes
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface QuoteRequest {
  id: string;
  user_id: string;
  order_item_id: string;
  title: string | null;
  product_url: string | null;
  store_name: string | null;
  status: string;
  quoted_shipping_usd: number | null;
  quoted_total_usd: number | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

const translations = {
  en: {
    title: "Vehicle Quote Requests",
    description: "Manage pricing quotes for vehicles and heavy items",
    noRequests: "No quote requests found",
    status: "Status",
    customer: "Customer",
    product: "Product",
    store: "Store",
    requestedAt: "Requested",
    basePrice: "Base Price",
    quotedShipping: "Quoted Shipping",
    quotedTotal: "Quoted Total",
    actions: "Actions",
    pending: "Pending",
    sent: "Sent",
    accepted: "Accepted",
    rejected: "Rejected",
    setQuote: "Set Quote",
    viewProduct: "View Product",
    quoteDialog: "Set Quote for Vehicle",
    shippingCost: "Shipping Cost (USD)",
    totalPrice: "Total Price (USD)",
    adminNotes: "Admin Notes",
    submitQuote: "Send Quote",
    cancel: "Cancel",
    quoteSuccess: "Quote sent successfully and customer notified",
    quoteError: "Failed to send quote",
    loading: "Loading...",
    quantity: "Qty",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    lastUpdated: "Last updated",
    autoRefresh: "Auto-refresh every 5 min",
    vehicle: "Vehicle",
  },
  fr: {
    title: "Demandes de devis véhicules",
    description: "Gérer les devis pour les véhicules et articles lourds",
    noRequests: "Aucune demande de devis trouvée",
    status: "Statut",
    customer: "Client",
    product: "Produit",
    store: "Magasin",
    requestedAt: "Demandé le",
    basePrice: "Prix de base",
    quotedShipping: "Livraison devisée",
    quotedTotal: "Total devisé",
    actions: "Actions",
    pending: "En attente",
    sent: "Envoyé",
    accepted: "Accepté",
    rejected: "Refusé",
    setQuote: "Définir le devis",
    viewProduct: "Voir le produit",
    quoteDialog: "Définir le devis pour le véhicule",
    shippingCost: "Coût de livraison (USD)",
    totalPrice: "Prix total (USD)",
    adminNotes: "Notes admin",
    submitQuote: "Envoyer le devis",
    cancel: "Annuler",
    quoteSuccess: "Devis envoyé avec succès et client notifié",
    quoteError: "Échec de l'envoi du devis",
    loading: "Chargement...",
    quantity: "Qté",
    refresh: "Actualiser",
    refreshing: "Actualisation...",
    lastUpdated: "Dernière mise à jour",
    autoRefresh: "Actualisation auto toutes les 5 min",
    vehicle: "Véhicule",
  },
  sw: {
    title: "Maombi ya Bei za Magari",
    description: "Simamia bei za magari na vitu vizito",
    noRequests: "Hakuna maombi ya bei",
    status: "Hali",
    customer: "Mteja",
    product: "Bidhaa",
    store: "Duka",
    requestedAt: "Iliombwa",
    basePrice: "Bei ya Msingi",
    quotedShipping: "Usafirishaji Ulionukuliwa",
    quotedTotal: "Jumla Iliyonukuliwa",
    actions: "Vitendo",
    pending: "Inasubiri",
    sent: "Imetumwa",
    accepted: "Imekubaliwa",
    rejected: "Imekataliwa",
    setQuote: "Weka Bei",
    viewProduct: "Tazama Bidhaa",
    quoteDialog: "Weka Bei kwa Gari",
    shippingCost: "Gharama ya Usafirishaji (USD)",
    totalPrice: "Bei Jumla (USD)",
    adminNotes: "Maelezo ya Admin",
    submitQuote: "Tuma Bei",
    cancel: "Ghairi",
    quoteSuccess: "Bei imetumwa kwa mafanikio",
    quoteError: "Imeshindwa kutuma bei",
    loading: "Inapakia...",
    quantity: "Idadi",
    refresh: "Sasisha",
    refreshing: "Inasasisha...",
    lastUpdated: "Ilisasishwa mwisho",
    autoRefresh: "Sasisha kiotomatiki kila dakika 5",
    vehicle: "Gari",
  },
  ln: {
    title: "Bandela ya Ntalo ya Motuka",
    description: "Bongisa ntalo ya motuka na biloko ya kilo",
    noRequests: "Bandela moko te",
    status: "Lolenge",
    customer: "Mosombi",
    product: "Eloko",
    store: "Magazini",
    requestedAt: "Esɛngamaki",
    basePrice: "Ntalo ya Ebandeli",
    quotedShipping: "Kobimisa Elobamaki",
    quotedTotal: "Ntalo Mobimba",
    actions: "Misala",
    pending: "Kozela",
    sent: "Etindamaki",
    accepted: "Endimamaki",
    rejected: "Eboyamaki",
    setQuote: "Kotia Ntalo",
    viewProduct: "Tala Eloko",
    quoteDialog: "Kotia Ntalo ya Motuka",
    shippingCost: "Ntalo ya Kobimisa (USD)",
    totalPrice: "Ntalo Mobimba (USD)",
    adminNotes: "Makomami ya Admin",
    submitQuote: "Tinda Ntalo",
    cancel: "Kolongola",
    quoteSuccess: "Ntalo etindamaki malamu",
    quoteError: "Elongaki te kotinda ntalo",
    loading: "Ezali kokota...",
    quantity: "Motango",
    refresh: "Bosala lisusu",
    refreshing: "Ezali kobongisa...",
    lastUpdated: "Ebongisami ya nsuka",
    autoRefresh: "Kobongisa yango moko miniti 5",
    vehicle: "Motuka",
  },
};

export default function QuoteRequests() {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;
  const locale = (language || 'en') as SupportedLocale;
  
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<QuoteRequest | null>(null);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Quote form state
  const [quotedShipping, setQuotedShipping] = useState("");
  const [quotedTotal, setQuotedTotal] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const fetchQuoteRequests = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      const { data, error } = await supabase
        .from("quote_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRequests(data || []);
      setLastUpdated(new Date());
    } catch (error: any) {
      console.error("Error fetching quote requests:", error);
      // Only show toast for manual actions, not silent auto-refresh
      if (!silent) {
        toast.error("Failed to load quote requests");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchQuoteRequests();
  }, [fetchQuoteRequests]);

  // Auto-refresh every 5 minutes (silent mode to avoid error toasts)
  useEffect(() => {
    const intervalId = setInterval(() => {
      console.log("[QuoteRequests] Auto-refreshing...");
      fetchQuoteRequests(true, true); // silent = true for auto-refresh
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [fetchQuoteRequests]);

  const handleManualRefresh = () => {
    fetchQuoteRequests(true);
  };

  // Helper to extract store name from URL
  const getStoreFromUrl = (url: string | null): string => {
    if (!url) return "-";
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes("cargurus")) return "CarGurus";
      if (hostname.includes("carvana")) return "Carvana";
      if (hostname.includes("autotrader")) return "AutoTrader";
      if (hostname.includes("cars.com")) return "Cars.com";
      if (hostname.includes("carmax")) return "CarMax";
      return hostname.replace("www.", "").split(".")[0];
    } catch {
      return "-";
    }
  };

  const openQuoteDialog = (request: QuoteRequest) => {
    setSelectedRequest(request);
    setQuotedShipping(request.quoted_shipping_usd?.toString() || "");
    setQuotedTotal(request.quoted_total_usd?.toString() || "");
    setAdminNotes(request.admin_notes || "");
    setQuoteDialogOpen(true);
  };

  const handleSubmitQuote = async () => {
    if (!selectedRequest) return;
    
    const shippingValue = parseFloat(quotedShipping);
    const totalValue = parseFloat(quotedTotal);
    
    if (isNaN(shippingValue) || isNaN(totalValue)) {
      toast.error("Please enter valid numbers for shipping and total");
      return;
    }

    if (shippingValue < 0 || totalValue < 0) {
      toast.error("Values must be positive");
      return;
    }
    
    setSubmitting(true);
    try {
      // Use the new admin-apply-vehicle-quote edge function
      // This handles all updates atomically: quote_requests, order_items, orders
      const { data, error } = await supabase.functions.invoke("admin-apply-vehicle-quote", {
        body: {
          quoteRequestId: selectedRequest.id,
          quotedShippingUsd: shippingValue,
          quotedTotalUsd: totalValue,
          adminNotes: adminNotes || undefined,
        },
      });

      if (error) {
        console.error("Error from admin-apply-vehicle-quote:", error);
        throw new Error(error.message || "Failed to apply quote");
      }

      if (!data?.success) {
        throw new Error(data?.error || "Failed to apply quote");
      }

      console.log("Quote applied successfully:", data);
      toast.success(t.quoteSuccess);
      setQuoteDialogOpen(false);
      fetchQuoteRequests();
    } catch (error: any) {
      console.error("Error submitting quote:", error);
      toast.error(error.message || t.quoteError);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      PENDING: { variant: "secondary", label: t.pending },
      SENT: { variant: "default", label: t.sent },
      ACCEPTED: { variant: "outline", label: t.accepted },
      REJECTED: { variant: "destructive", label: t.rejected },
    };
    const config = statusMap[status] || statusMap.PENDING;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Car className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{t.title}</h1>
            <p className="text-muted-foreground">{t.description}</p>
          </div>
        </div>
        
        {/* Refresh button and status */}
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {t.lastUpdated}: {lastUpdated.toLocaleTimeString()}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t.autoRefresh}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? t.refreshing : t.refresh}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {t.title}
            <Badge variant="outline" className="ml-2">{requests.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">{t.loading}</span>
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Car className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t.noRequests}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">{t.status}</TableHead>
                    <TableHead className="min-w-[250px]">{t.product}</TableHead>
                    <TableHead className="w-[120px]">{t.store}</TableHead>
                    <TableHead className="w-[120px]">{t.quotedShipping}</TableHead>
                    <TableHead className="w-[120px]">{t.quotedTotal}</TableHead>
                    <TableHead className="w-[150px]">{t.requestedAt}</TableHead>
                    <TableHead className="w-[150px]">{t.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>{getStatusBadge(request.status)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-sm line-clamp-2">
                            {request.title || t.vehicle}
                          </p>
                          {request.product_url && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <a 
                                    href={request.product_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline flex items-center gap-1 max-w-[230px]"
                                  >
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">
                                      {new URL(request.product_url).hostname.replace('www.', '')}
                                    </span>
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-[400px]">
                                  <p className="break-all text-xs">{request.product_url}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Store className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{request.store_name || getStoreFromUrl(request.product_url)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={request.quoted_shipping_usd ? "font-medium text-green-600" : "text-muted-foreground"}>
                          {request.quoted_shipping_usd
                            ? formatCurrency(request.quoted_shipping_usd, { currency: 'USD', locale })
                            : "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={request.quoted_total_usd ? "font-medium text-green-600" : "text-muted-foreground"}>
                          {request.quoted_total_usd
                            ? formatCurrency(request.quoted_total_usd, { currency: 'USD', locale })
                            : "-"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(request.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={request.status === 'PENDING' ? "default" : "outline"}
                            onClick={() => openQuoteDialog(request)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            {t.setQuote}
                          </Button>
                          {request.product_url && (
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                            >
                              <a
                                href={request.product_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quote Dialog */}
      <Dialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="h-5 w-5" />
              {t.quoteDialog}
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p className="font-medium">{selectedRequest?.title || t.vehicle}</p>
              {selectedRequest?.product_url && (
                <a 
                  href={selectedRequest.product_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 break-all"
                >
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  {selectedRequest.product_url}
                </a>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="quotedShipping">{t.shippingCost}</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="quotedShipping"
                  type="number"
                  step="0.01"
                  min="0"
                  value={quotedShipping}
                  onChange={(e) => setQuotedShipping(e.target.value)}
                  className="pl-9"
                  placeholder="0.00"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="quotedTotal">{t.totalPrice}</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="quotedTotal"
                  type="number"
                  step="0.01"
                  min="0"
                  value={quotedTotal}
                  onChange={(e) => setQuotedTotal(e.target.value)}
                  className="pl-9"
                  placeholder="0.00"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="adminNotes">{t.adminNotes}</Label>
              <Textarea
                id="adminNotes"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes about this quote..."
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button onClick={handleSubmitQuote} disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {t.submitQuote}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
