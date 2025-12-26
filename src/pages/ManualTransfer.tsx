import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Copy, 
  Check, 
  Upload, 
  FileText, 
  AlertTriangle, 
  Clock,
  CheckCircle2,
  Home,
  MessageCircle,
  Mail,
  Loader2,
  Building2,
  CreditCard,
  Hash
} from "lucide-react";

interface BankDetails {
  account_name: string;
  bank_name: string;
  account_number: string;
  currency: string;
  instructions_fr: string;
  instructions_en: string;
  support_whatsapp: string;
  support_email: string;
}

interface PageData {
  reference: string;
  status: string;
  expires_at: string;
  has_proof: boolean;
  proof_status: string | null;
  bank: BankDetails;
}

const isValidToken = (token: string | undefined): boolean => {
  if (!token) return false;
  if (token === ":uploadToken") return false;
  if (token.length < 32) return false;
  return true;
};

export default function ManualTransfer() {
  const { uploadToken } = useParams<{ uploadToken: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isValidToken(uploadToken)) {
      setError("Lien invalide");
      setErrorCode("INVALID_TOKEN");
      setLoading(false);
      return;
    }

    fetchPageData();
  }, [uploadToken]);

  const fetchPageData = async () => {
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "get-manual-transfer-page",
        { body: { upload_token: uploadToken } }
      );

      if (invokeError) {
        console.error("Error fetching page data:", invokeError);
        setError("Erreur lors du chargement de la page");
        setLoading(false);
        return;
      }

      if (!data.ok) {
        setError(data.error || "Session invalide");
        setErrorCode(data.code);
        setLoading(false);
        return;
      }

      setPageData(data);
      if (data.has_proof) {
        setUploadSuccess(true);
      }
    } catch (err: any) {
      console.error("Error:", err);
      setError("Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success("Copié!");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("Erreur lors de la copie");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Fichier trop volumineux. Maximum 10MB.");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !uploadToken) return;

    setUploading(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      const base64Data = await base64Promise;

      const { data, error: invokeError } = await supabase.functions.invoke(
        "upload-manual-transfer-proof",
        {
          body: {
            upload_token: uploadToken,
            file_base64: base64Data,
            filename: selectedFile.name,
            mime_type: selectedFile.type,
          },
        }
      );

      if (invokeError) {
        console.error("Upload error:", invokeError);
        toast.error("Erreur lors de l'envoi");
        return;
      }

      if (!data.ok) {
        toast.error(data.error || "Erreur lors de l'envoi");
        return;
      }

      setUploadSuccess(true);
      toast.success("Preuve envoyée avec succès!");
      setSelectedFile(null);
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Une erreur est survenue");
    } finally {
      setUploading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Lien invalide</CardTitle>
            <CardDescription>
              {errorCode === "EXPIRED" 
                ? "Ce lien de paiement a expiré. Veuillez contacter le support pour obtenir un nouveau lien."
                : "Ce lien de paiement est incomplet ou invalide. Veuillez ouvrir le lien complet reçu par email ou SMS."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button 
              onClick={() => navigate("/")} 
              className="w-full"
              variant="default"
            >
              <Home className="mr-2 h-4 w-4" />
              Retour à l'accueil
            </Button>
            <Button 
              onClick={() => window.location.href = "mailto:support@afrishop-usa.com"}
              variant="outline"
              className="w-full"
            >
              <Mail className="mr-2 h-4 w-4" />
              Contacter le support
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!pageData) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-primary">AfriShop</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="space-y-6">
          {/* Title */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold">Paiement par virement bancaire</h1>
            <p className="text-muted-foreground">
              Effectuez votre virement en utilisant les informations ci-dessous
            </p>
          </div>

          {/* Bank Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Coordonnées bancaires
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Account Name */}
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">Titulaire du compte</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-3 bg-muted rounded-md font-medium">
                    {pageData.bank.account_name}
                  </div>
                </div>
              </div>

              {/* Bank Name */}
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">Banque</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-3 bg-muted rounded-md font-medium">
                    {pageData.bank.bank_name}
                  </div>
                </div>
              </div>

              {/* Account Number */}
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Numéro de compte
                </Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-3 bg-muted rounded-md font-mono text-lg tracking-wider">
                    {pageData.bank.account_number || "Non configuré"}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(pageData.bank.account_number, "account")}
                    disabled={!pageData.bank.account_number}
                  >
                    {copiedField === "account" ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Currency */}
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">Devise</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-3 bg-muted rounded-md font-medium">
                    {pageData.bank.currency}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reference Card */}
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Hash className="h-5 w-5" />
                Référence à utiliser
              </CardTitle>
              <CardDescription>
                Utilisez impérativement cette référence lors de votre virement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-4 bg-primary/10 rounded-md font-mono text-xl font-bold text-primary tracking-wider text-center">
                  {pageData.reference}
                </div>
                <Button
                  variant="default"
                  size="icon"
                  onClick={() => copyToClipboard(pageData.reference, "reference")}
                >
                  {copiedField === "reference" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Upload Proof Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Preuve de paiement
              </CardTitle>
              <CardDescription>
                Envoyez une capture d'écran ou un PDF de votre confirmation de virement
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {uploadSuccess ? (
                <div className="p-6 bg-green-50 dark:bg-green-900/20 rounded-lg text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-green-800 dark:text-green-200">
                      Preuve envoyée avec succès
                    </h3>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      Votre paiement est en attente de validation par notre équipe.
                    </p>
                  </div>
                  {pageData.proof_status === "pending" && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      En attente de vérification
                    </div>
                  )}
                  {pageData.proof_status === "approved" && (
                    <div className="flex items-center justify-center gap-2 text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Paiement validé
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <Input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="proof-upload"
                    />
                    <label
                      htmlFor="proof-upload"
                      className="cursor-pointer flex flex-col items-center gap-3"
                    >
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <FileText className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {selectedFile ? selectedFile.name : "Cliquez pour sélectionner"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Image ou PDF, max 10MB
                        </p>
                      </div>
                    </label>
                  </div>
                  
                  {selectedFile && (
                    <Button 
                      onClick={handleUpload} 
                      className="w-full" 
                      disabled={uploading}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Envoi en cours...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Envoyer la preuve
                        </>
                      )}
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert">
              <p>{pageData.bank.instructions_fr}</p>
            </CardContent>
          </Card>

          {/* Support */}
          {(pageData.bank.support_whatsapp || pageData.bank.support_email) && (
            <Card>
              <CardHeader>
                <CardTitle>Besoin d'aide?</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {pageData.bank.support_whatsapp && (
                  <Button
                    variant="outline"
                    onClick={() => window.open(`https://wa.me/${pageData.bank.support_whatsapp.replace(/[^0-9]/g, "")}`, "_blank")}
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    WhatsApp
                  </Button>
                )}
                {pageData.bank.support_email && (
                  <Button
                    variant="outline"
                    onClick={() => window.location.href = `mailto:${pageData.bank.support_email}`}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Email
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Expiry notice */}
          <div className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Clock className="h-4 w-4" />
            Ce lien expire le {new Date(pageData.expires_at).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
