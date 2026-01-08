import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  DollarSign, 
  ExternalLink, 
  Clock, 
  Loader2, 
  RefreshCw, 
  Store, 
  Check, 
  X, 
  Edit2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye
} from "lucide-react";
import { formatCurrency, type SupportedLocale } from "@/lib/formatCurrency";

// Auto-refresh interval: 2 minutes
const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

interface PriceConfirmation {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  cart_item_id: string | null;
  product_url: string;
  store: string;
  proposed_price: number;
  proposed_currency: string;
  extracted_price: number | null;
  extracted_currency: string | null;
  extraction_source: string | null;
  extraction_confidence: number | null;
  status: string;
  admin_price: number | null;
  admin_currency: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // Joined from profiles
  user_email?: string | null;
}

const translations = {
  en: {
    title: "Price Confirmations",
    description: "Review and approve user-submitted prices for products",
    noRequests: "No price confirmation requests found",
    status: "Status",
    customer: "Customer",
    product: "Product URL",
    store: "Store",
    requestedAt: "Requested",
    proposedPrice: "Proposed",
    extractedPrice: "Extracted",
    confidence: "Confidence",
    adminPrice: "Admin Price",
    actions: "Actions",
    pending: "Pending",
    approved: "Approved",
    adjusted: "Adjusted",
    rejected: "Rejected",
    approve: "Approve",
    adjust: "Adjust",
    reject: "Reject",
    viewProduct: "View Product",
    reviewDialog: "Review Price",
    newPrice: "New Price (USD)",
    newCurrency: "Currency",
    adminNote: "Admin Note",
    submit: "Submit",
    cancel: "Cancel",
    success: "Price confirmation updated",
    error: "Failed to update price confirmation",
    loading: "Loading...",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    lastUpdated: "Last updated",
    autoRefresh: "Auto-refresh every 2 min",
    filterByStatus: "Filter by status",
    all: "All",
    viewDetails: "View Details",
    lowConfidence: "Low confidence extraction",
    manualEntry: "Manual entry",
    source: "Source",
    details: "Details",
    confirmAction: "Confirm Action",
  },
  fr: {
    title: "Confirmations de prix",
    description: "Vérifier et approuver les prix soumis par les utilisateurs",
    noRequests: "Aucune demande de confirmation de prix",
    status: "Statut",
    customer: "Client",
    product: "URL du produit",
    store: "Magasin",
    requestedAt: "Demandé le",
    proposedPrice: "Proposé",
    extractedPrice: "Extrait",
    confidence: "Confiance",
    adminPrice: "Prix admin",
    actions: "Actions",
    pending: "En attente",
    approved: "Approuvé",
    adjusted: "Ajusté",
    rejected: "Rejeté",
    approve: "Approuver",
    adjust: "Ajuster",
    reject: "Rejeter",
    viewProduct: "Voir le produit",
    reviewDialog: "Vérifier le prix",
    newPrice: "Nouveau prix (USD)",
    newCurrency: "Devise",
    adminNote: "Note admin",
    submit: "Soumettre",
    cancel: "Annuler",
    success: "Confirmation de prix mise à jour",
    error: "Échec de la mise à jour",
    loading: "Chargement...",
    refresh: "Actualiser",
    refreshing: "Actualisation...",
    lastUpdated: "Dernière mise à jour",
    autoRefresh: "Actualisation auto toutes les 2 min",
    filterByStatus: "Filtrer par statut",
    all: "Tous",
    viewDetails: "Voir les détails",
    lowConfidence: "Extraction à faible confiance",
    manualEntry: "Saisie manuelle",
    source: "Source",
    details: "Détails",
    confirmAction: "Confirmer l'action",
  },
  sw: {
    title: "Uthibitisho wa Bei",
    description: "Kagua na uidhinishe bei zilizowasilishwa na watumiaji",
    noRequests: "Hakuna maombi ya uthibitisho wa bei",
    status: "Hali",
    customer: "Mteja",
    product: "URL ya Bidhaa",
    store: "Duka",
    requestedAt: "Iliombwa",
    proposedPrice: "Iliyopendekezwa",
    extractedPrice: "Iliyotolewa",
    confidence: "Uhakika",
    adminPrice: "Bei ya Admin",
    actions: "Vitendo",
    pending: "Inasubiri",
    approved: "Imeidhinishwa",
    adjusted: "Imebadilishwa",
    rejected: "Imekataliwa",
    approve: "Idhinisha",
    adjust: "Badilisha",
    reject: "Kataa",
    viewProduct: "Tazama Bidhaa",
    reviewDialog: "Kagua Bei",
    newPrice: "Bei Mpya (USD)",
    newCurrency: "Sarafu",
    adminNote: "Maelezo ya Admin",
    submit: "Wasilisha",
    cancel: "Ghairi",
    success: "Uthibitisho wa bei umesasishwa",
    error: "Imeshindwa kusasisha",
    loading: "Inapakia...",
    refresh: "Sasisha",
    refreshing: "Inasasisha...",
    lastUpdated: "Ilisasishwa mwisho",
    autoRefresh: "Sasisha kiotomatiki kila dakika 2",
    filterByStatus: "Chuja kwa hali",
    all: "Zote",
    viewDetails: "Tazama Maelezo",
    lowConfidence: "Utoaji wa uhakika mdogo",
    manualEntry: "Ingizo la mwongozo",
    source: "Chanzo",
    details: "Maelezo",
    confirmAction: "Thibitisha Kitendo",
  },
  ln: {
    title: "Bondeli ya Ntalo",
    description: "Tala mpe ndima ntalo oyo basombi batindi",
    noRequests: "Bandela moko te",
    status: "Lolenge",
    customer: "Mosombi",
    product: "URL ya Eloko",
    store: "Magazini",
    requestedAt: "Esɛngamaki",
    proposedPrice: "Etyamaki",
    extractedPrice: "Elongolamaki",
    confidence: "Bondeli",
    adminPrice: "Ntalo ya Admin",
    actions: "Misala",
    pending: "Kozela",
    approved: "Endimamaki",
    adjusted: "Ebongwanaki",
    rejected: "Eboyamaki",
    approve: "Ndima",
    adjust: "Bongisa",
    reject: "Boya",
    viewProduct: "Tala Eloko",
    reviewDialog: "Tala Ntalo",
    newPrice: "Ntalo ya sika (USD)",
    newCurrency: "Mbongo",
    adminNote: "Makomami ya Admin",
    submit: "Tinda",
    cancel: "Kolongola",
    success: "Ntalo ebongisami",
    error: "Elongaki te kobongisa",
    loading: "Ezali kokota...",
    refresh: "Bosala lisusu",
    refreshing: "Ezali kobongisa...",
    lastUpdated: "Ebongisami ya nsuka",
    autoRefresh: "Kobongisa yango moko miniti 2",
    filterByStatus: "Pona na lolenge",
    all: "Nionso",
    viewDetails: "Tala Maelezo",
    lowConfidence: "Elongolami na bondeli moke",
    manualEntry: "Bokɔtisi na loboko",
    source: "Liziba",
    details: "Maelezo",
    confirmAction: "Ndima Mosala",
  },
};

export default function PriceConfirmations() {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;
  const locale = (language || 'en') as SupportedLocale;

  const [confirmations, setConfirmations] = useState<PriceConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  
  // Detail sheet state
  const [selectedConfirmation, setSelectedConfirmation] = useState<PriceConfirmation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  
  // Review dialog state
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'ADJUST' | 'REJECT'>('APPROVE');
  const [adminPrice, setAdminPrice] = useState("");
  const [adminCurrency, setAdminCurrency] = useState("USD");
  const [adminNote, setAdminNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchConfirmations = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // Fetch price confirmations (no FK relationship to profiles)
      let query = supabase
        .from("price_confirmations")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "ALL") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch user emails separately for the user_ids we have
      const userIds = [...new Set((data || []).map(item => item.user_id))];
      let emailMap: Record<string, string> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, email")
          .in("user_id", userIds);
        
        emailMap = (profiles || []).reduce((acc, p) => {
          if (p.email) acc[p.user_id] = p.email;
          return acc;
        }, {} as Record<string, string>);
      }

      // Map to include user_email at top level
      const mappedData = (data || []).map(item => ({
        ...item,
        user_email: emailMap[item.user_id] || null,
      }));

      setConfirmations(mappedData);
      setLastUpdated(new Date());
    } catch (error: any) {
      console.error("Error fetching price confirmations:", error);
      if (!silent) {
        toast.error("Failed to load price confirmations");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  // Initial fetch
  useEffect(() => {
    fetchConfirmations();
  }, [fetchConfirmations]);

  // Auto-refresh
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchConfirmations(true, true);
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [fetchConfirmations]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('price-confirmations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'price_confirmations' },
        () => {
          fetchConfirmations(true, true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchConfirmations]);

  const handleManualRefresh = () => {
    fetchConfirmations(true);
  };

  const openDetailSheet = (confirmation: PriceConfirmation) => {
    setSelectedConfirmation(confirmation);
    setDetailOpen(true);
  };

  const openReviewDialog = (confirmation: PriceConfirmation, action: 'APPROVE' | 'ADJUST' | 'REJECT') => {
    setSelectedConfirmation(confirmation);
    setReviewAction(action);
    setAdminPrice(confirmation.proposed_price.toString());
    setAdminCurrency(confirmation.proposed_currency);
    setAdminNote("");
    setReviewDialogOpen(true);
  };

  const handleReviewSubmit = async () => {
    if (!selectedConfirmation) return;

    setSubmitting(true);
    try {
      const body: any = {
        confirmation_id: selectedConfirmation.id,
        action: reviewAction,
        admin_note: adminNote || undefined,
      };

      if (reviewAction === 'ADJUST') {
        const price = parseFloat(adminPrice);
        if (isNaN(price) || price <= 0) {
          toast.error("Please enter a valid price");
          setSubmitting(false);
          return;
        }
        body.admin_price = price;
        body.admin_currency = adminCurrency;
      } else if (reviewAction === 'APPROVE') {
        // Optionally allow admin to override price on approve
        const price = parseFloat(adminPrice);
        if (!isNaN(price) && price > 0) {
          body.admin_price = price;
          body.admin_currency = adminCurrency;
        }
      }

      const { data, error } = await supabase.functions.invoke("admin-review-price-confirmation", {
        body,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to update");

      toast.success(t.success);
      setReviewDialogOpen(false);
      setDetailOpen(false);
      fetchConfirmations();
    } catch (error: any) {
      console.error("Error reviewing price confirmation:", error);
      toast.error(error.message || t.error);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; icon: React.ReactNode }> = {
      PENDING: { variant: "secondary", label: t.pending, icon: <Clock className="h-3 w-3" /> },
      APPROVED: { variant: "default", label: t.approved, icon: <CheckCircle className="h-3 w-3" /> },
      ADJUSTED: { variant: "outline", label: t.adjusted, icon: <Edit2 className="h-3 w-3" /> },
      REJECTED: { variant: "destructive", label: t.rejected, icon: <XCircle className="h-3 w-3" /> },
    };
    const config = statusMap[status] || statusMap.PENDING;
    return (
      <Badge variant={config.variant} className="gap-1">
        {config.icon}
        {config.label}
      </Badge>
    );
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

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return "text-muted-foreground";
    if (confidence >= 0.8) return "text-green-600";
    if (confidence >= 0.5) return "text-yellow-600";
    return "text-red-600";
  };

  const truncateUrl = (url: string, maxLength = 40) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + "...";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <DollarSign className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{t.title}</h1>
            <p className="text-muted-foreground text-sm">{t.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {t.lastUpdated}: {formatDate(lastUpdated.toISOString())}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {refreshing ? t.refreshing : t.refresh}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <Label>{t.filterByStatus}</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t.all}</SelectItem>
                <SelectItem value="PENDING">{t.pending}</SelectItem>
                <SelectItem value="APPROVED">{t.approved}</SelectItem>
                <SelectItem value="ADJUSTED">{t.adjusted}</SelectItem>
                <SelectItem value="REJECTED">{t.rejected}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : confirmations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t.noRequests}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.status}</TableHead>
                    <TableHead>{t.customer}</TableHead>
                    <TableHead>{t.store}</TableHead>
                    <TableHead>{t.proposedPrice}</TableHead>
                    <TableHead>{t.extractedPrice}</TableHead>
                    <TableHead>{t.confidence}</TableHead>
                    <TableHead>{t.requestedAt}</TableHead>
                    <TableHead className="text-right">{t.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {confirmations.map((confirmation) => (
                    <TableRow key={confirmation.id}>
                      <TableCell>{getStatusBadge(confirmation.status)}</TableCell>
                      <TableCell className="font-medium">
                        {confirmation.user_email || confirmation.user_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{confirmation.store}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatCurrency(confirmation.proposed_price, { currency: confirmation.proposed_currency as any, locale })}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {confirmation.extracted_price !== null
                          ? formatCurrency(confirmation.extracted_price, { currency: (confirmation.extracted_currency || 'USD') as any, locale })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {confirmation.extraction_confidence !== null ? (
                          <span className={getConfidenceColor(confirmation.extraction_confidence)}>
                            {Math.round(confirmation.extraction_confidence * 100)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {confirmation.extraction_source === 'manual' && (
                          <AlertTriangle className="h-4 w-4 inline ml-1 text-yellow-500" />
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(confirmation.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDetailSheet(confirmation)}
                            title={t.viewDetails}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {confirmation.status === 'PENDING' && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() => openReviewDialog(confirmation, 'APPROVE')}
                                title={t.approve}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                onClick={() => openReviewDialog(confirmation, 'ADJUST')}
                                title={t.adjust}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => openReviewDialog(confirmation, 'REJECT')}
                                title={t.reject}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                          >
                            <a
                              href={confirmation.product_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={t.viewProduct}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
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

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t.details}</SheetTitle>
            <SheetDescription>
              {selectedConfirmation?.product_url && truncateUrl(selectedConfirmation.product_url, 50)}
            </SheetDescription>
          </SheetHeader>
          {selectedConfirmation && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t.status}</span>
                {getStatusBadge(selectedConfirmation.status)}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">{t.store}</Label>
                  <p className="font-medium">{selectedConfirmation.store}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t.customer}</Label>
                  <p className="font-medium">{selectedConfirmation.user_email || selectedConfirmation.user_id.slice(0, 8)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t.proposedPrice}</Label>
                  <p className="font-mono font-medium">
                    {formatCurrency(selectedConfirmation.proposed_price, { currency: selectedConfirmation.proposed_currency as any, locale })}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t.extractedPrice}</Label>
                  <p className="font-mono font-medium">
                    {selectedConfirmation.extracted_price !== null
                      ? formatCurrency(selectedConfirmation.extracted_price, { currency: (selectedConfirmation.extracted_currency || 'USD') as any, locale })
                      : "-"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t.source}</Label>
                  <p className="font-medium capitalize">{selectedConfirmation.extraction_source || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t.confidence}</Label>
                  <p className={`font-medium ${getConfidenceColor(selectedConfirmation.extraction_confidence)}`}>
                    {selectedConfirmation.extraction_confidence !== null
                      ? `${Math.round(selectedConfirmation.extraction_confidence * 100)}%`
                      : "-"}
                  </p>
                </div>
                {selectedConfirmation.admin_price !== null && (
                  <div>
                    <Label className="text-muted-foreground">{t.adminPrice}</Label>
                    <p className="font-mono font-medium text-primary">
                      {formatCurrency(selectedConfirmation.admin_price, { currency: (selectedConfirmation.admin_currency || 'USD') as any, locale })}
                    </p>
                  </div>
                )}
                {selectedConfirmation.reviewed_at && (
                  <div>
                    <Label className="text-muted-foreground">Reviewed At</Label>
                    <p className="font-medium">{formatDate(selectedConfirmation.reviewed_at)}</p>
                  </div>
                )}
              </div>
              {selectedConfirmation.admin_note && (
                <div>
                  <Label className="text-muted-foreground">{t.adminNote}</Label>
                  <p className="mt-1 text-sm bg-muted p-2 rounded">{selectedConfirmation.admin_note}</p>
                </div>
              )}
              <div className="pt-4 border-t">
                <Button
                  variant="outline"
                  className="w-full"
                  asChild
                >
                  <a
                    href={selectedConfirmation.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t.viewProduct}
                  </a>
                </Button>
              </div>
              {selectedConfirmation.status === 'PENDING' && (
                <div className="grid grid-cols-3 gap-2 pt-2">
                  <Button
                    variant="default"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => openReviewDialog(selectedConfirmation, 'APPROVE')}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    {t.approve}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => openReviewDialog(selectedConfirmation, 'ADJUST')}
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    {t.adjust}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => openReviewDialog(selectedConfirmation, 'REJECT')}
                  >
                    <X className="h-4 w-4 mr-1" />
                    {t.reject}
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'APPROVE' && t.approve}
              {reviewAction === 'ADJUST' && t.adjust}
              {reviewAction === 'REJECT' && t.reject}
            </DialogTitle>
            <DialogDescription>
              {selectedConfirmation && truncateUrl(selectedConfirmation.product_url, 60)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {(reviewAction === 'ADJUST' || reviewAction === 'APPROVE') && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="adminPrice">{t.newPrice}</Label>
                  <Input
                    id="adminPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={adminPrice}
                    onChange={(e) => setAdminPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="adminCurrency">{t.newCurrency}</Label>
                  <Select value={adminCurrency} onValueChange={setAdminCurrency}>
                    <SelectTrigger id="adminCurrency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CDF">CDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="adminNote">{t.adminNote}</Label>
              <Textarea
                id="adminNote"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Optional note..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              onClick={handleReviewSubmit}
              disabled={submitting}
              variant={reviewAction === 'REJECT' ? 'destructive' : 'default'}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
