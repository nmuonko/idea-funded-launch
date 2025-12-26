import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle,
  XCircle,
  Eye,
  Download,
  Loader2,
  RefreshCw,
  FileText,
  Clock,
  Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface TransferProof {
  id: string;
  session_id: string;
  order_id: string;
  reference: string;
  file_path: string;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_notes: string | null;
  created_at: string;
}

export default function TransferProofs() {
  const [proofs, setProofs] = useState<TransferProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProof, setSelectedProof] = useState<TransferProof | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    fetchProofs();
  }, []);

  const fetchProofs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("manual_transfer_proofs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setProofs(data || []);
    } catch (err) {
      console.error("Error fetching proofs:", err);
      toast.error("Erreur lors du chargement des preuves");
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async () => {
    if (!selectedProof || !reviewAction) return;

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from("manual_transfer_proofs")
        .update({
          status: reviewAction,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          admin_notes: adminNotes || null,
        })
        .eq("id", selectedProof.id);

      if (error) throw error;

      toast.success(reviewAction === "approved" ? "Paiement approuvé" : "Paiement rejeté");
      setShowReviewDialog(false);
      setSelectedProof(null);
      setAdminNotes("");
      setReviewAction(null);
      fetchProofs();
    } catch (err) {
      console.error("Error reviewing proof:", err);
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = async (proof: TransferProof) => {
    try {
      const { data, error } = await supabase.storage
        .from("payment-proofs")
        .createSignedUrl(proof.file_path, 300); // 5 min URL

      if (error) throw error;
      
      setPreviewUrl(data.signedUrl);
      setSelectedProof(proof);
      setShowPreview(true);
    } catch (err) {
      console.error("Error getting preview URL:", err);
      toast.error("Erreur lors de la prévisualisation");
    }
  };

  const handleDownload = async (proof: TransferProof) => {
    try {
      const { data, error } = await supabase.storage
        .from("payment-proofs")
        .download(proof.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = proof.original_filename || `proof-${proof.reference}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading:", err);
      toast.error("Erreur lors du téléchargement");
    }
  };

  const openReviewDialog = (proof: TransferProof, action: "approved" | "rejected") => {
    setSelectedProof(proof);
    setReviewAction(action);
    setAdminNotes("");
    setShowReviewDialog(true);
  };

  const filteredProofs = proofs.filter((proof) => {
    const matchesSearch = 
      proof.reference.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proof.order_id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || proof.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><Clock className="h-3 w-3 mr-1" /> En attente</Badge>;
      case "approved":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCircle className="h-3 w-3 mr-1" /> Approuvé</Badge>;
      case "rejected":
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><XCircle className="h-3 w-3 mr-1" /> Rejeté</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Preuves de virement</h1>
          <p className="text-muted-foreground">
            Gérez les preuves de paiement par virement bancaire
          </p>
        </div>
        <Button onClick={fetchProofs} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualiser
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par référence ou ID commande..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("all")}
              >
                Tous ({proofs.length})
              </Button>
              <Button
                variant={statusFilter === "pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("pending")}
              >
                En attente ({proofs.filter(p => p.status === "pending").length})
              </Button>
              <Button
                variant={statusFilter === "approved" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("approved")}
              >
                Approuvés ({proofs.filter(p => p.status === "approved").length})
              </Button>
              <Button
                variant={statusFilter === "rejected" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("rejected")}
              >
                Rejetés ({proofs.filter(p => p.status === "rejected").length})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Proofs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Preuves de paiement</CardTitle>
          <CardDescription>
            {filteredProofs.length} preuve(s) trouvée(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredProofs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Aucune preuve de virement trouvée</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Fichier</TableHead>
                  <TableHead>Taille</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProofs.map((proof) => (
                  <TableRow key={proof.id}>
                    <TableCell className="font-mono font-medium">
                      {proof.reference}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {proof.original_filename || "Fichier"}
                    </TableCell>
                    <TableCell>{formatFileSize(proof.size_bytes)}</TableCell>
                    <TableCell>
                      {formatDistanceToNow(new Date(proof.created_at), {
                        addSuffix: true,
                        locale: fr,
                      })}
                    </TableCell>
                    <TableCell>{getStatusBadge(proof.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePreview(proof)}
                          title="Voir"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownload(proof)}
                          title="Télécharger"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {proof.status === "pending" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openReviewDialog(proof, "approved")}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                              title="Approuver"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openReviewDialog(proof, "rejected")}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Rejeter"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approved" ? "Approuver le paiement" : "Rejeter le paiement"}
            </DialogTitle>
            <DialogDescription>
              Référence: {selectedProof?.reference}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Notes (optionnel)</Label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Ajouter des notes..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowReviewDialog(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button
              onClick={handleReview}
              disabled={submitting}
              variant={reviewAction === "approved" ? "default" : "destructive"}
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {reviewAction === "approved" ? "Approuver" : "Rejeter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Prévisualisation</DialogTitle>
            <DialogDescription>
              {selectedProof?.original_filename} - {selectedProof?.reference}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {previewUrl && selectedProof?.mime_type?.startsWith("image/") ? (
              <img 
                src={previewUrl} 
                alt="Proof" 
                className="max-w-full h-auto mx-auto"
              />
            ) : previewUrl && selectedProof?.mime_type === "application/pdf" ? (
              <iframe
                src={previewUrl}
                className="w-full h-[70vh]"
                title="PDF Preview"
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Format non supporté pour la prévisualisation
              </div>
            )}
          </div>
          <DialogFooter>
            {selectedProof && (
              <Button onClick={() => handleDownload(selectedProof)}>
                <Download className="h-4 w-4 mr-2" />
                Télécharger
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
