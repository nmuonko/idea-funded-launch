import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Copy, Check, AlertCircle, Phone, Mail, Loader2, 
  Building2, User, Hash, FileText, Upload, CheckCircle2 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import afrishopLogo from "@/assets/afrishop-logo.png";

interface BankDetails {
  beneficiary_name: string;
  bank_name: string;
  account_number_or_iban: string;
  swift_bic: string;
  instructions_fr: string;
  instructions_en: string;
  support_whatsapp: string;
  support_email: string;
}

const uploadSchema = z.object({
  reference: z.string().min(1, "La référence est requise / Reference is required"),
  name: z.string().optional(),
  contact: z.string().optional(),
  file: z.any().refine((files) => files?.length > 0, "Un fichier est requis / File is required"),
});

type UploadFormData = z.infer<typeof uploadSchema>;

const PublicBankTransfer = () => {
  const [searchParams] = useSearchParams();
  const refParam = searchParams.get("ref") || "";
  
  const [loading, setLoading] = useState(true);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const form = useForm<UploadFormData>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      reference: refParam,
      name: "",
      contact: "",
    },
  });

  // Update reference when URL param changes
  useEffect(() => {
    if (refParam) {
      form.setValue("reference", refParam);
    }
  }, [refParam, form]);

  useEffect(() => {
    const fetchBankDetails = async () => {
      try {
        const { data, error } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "bank_transfer_details")
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("Error fetching bank details:", error);
        }

        if (data?.value) {
          const parsed = typeof data.value === "string" 
            ? JSON.parse(data.value) 
            : data.value;
          setBankDetails({
            beneficiary_name: parsed.beneficiary_name || "AfriShop USA LLC",
            bank_name: parsed.bank_name || "Equity BCDC",
            account_number_or_iban: parsed.account_number_or_iban || "",
            swift_bic: parsed.swift_bic || "",
            instructions_fr: parsed.instructions_fr || "Veuillez inclure la référence dans le libellé du virement.",
            instructions_en: parsed.instructions_en || "Please include the reference in the transfer description.",
            support_whatsapp: parsed.support_whatsapp || "",
            support_email: parsed.support_email || "",
          });
        } else {
          // Default values if no settings exist
          setBankDetails({
            beneficiary_name: "AfriShop USA LLC",
            bank_name: "Equity BCDC",
            account_number_or_iban: "",
            swift_bic: "",
            instructions_fr: "Veuillez inclure la référence dans le libellé du virement.",
            instructions_en: "Please include the reference in the transfer description.",
            support_whatsapp: "",
            support_email: "",
          });
        }
      } catch (err) {
        console.error("Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchBankDetails();
  }, []);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(language === "fr" ? "Copié ✅" : "Copied ✅");
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      toast.error(language === "fr" ? "Erreur de copie" : "Copy failed");
    }
  };

  const CopyButton = ({ value, field }: { value: string; field: string }) => (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 shrink-0"
      onClick={() => copyToClipboard(value, field)}
      disabled={!value}
    >
      {copiedField === field ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </Button>
  );

  const DetailRow = ({ 
    icon: Icon, 
    label, 
    value, 
    field, 
    highlight = false 
  }: { 
    icon: React.ElementType;
    label: string; 
    value: string | null | undefined; 
    field: string;
    highlight?: boolean;
  }) => (
    <div className={`flex items-center justify-between py-4 px-3 rounded-lg ${highlight ? "bg-primary/5 border border-primary/20" : ""}`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={`font-medium break-all ${highlight ? "text-lg text-primary" : "text-foreground"}`}>
            {value || "-"}
          </p>
        </div>
      </div>
      {value && <CopyButton value={value} field={field} />}
    </div>
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
      form.setValue("file", files);
    }
  };

  const onSubmit = async (values: UploadFormData) => {
    if (!selectedFile) {
      toast.error(language === "fr" ? "Veuillez sélectionner un fichier" : "Please select a file");
      return;
    }

    setUploading(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      // Call edge function
      const { data, error } = await supabase.functions.invoke("submit-bank-transfer-proof", {
        body: {
          reference: values.reference,
          name: values.name || null,
          contact: values.contact || null,
          file_base64: fileBase64,
          file_name: selectedFile.name,
          file_type: selectedFile.type,
        },
      });

      if (error) {
        console.error("Upload error:", error);
        toast.error(language === "fr" 
          ? "Erreur lors de l'envoi. Veuillez réessayer." 
          : "Upload failed. Please try again.");
        return;
      }

      if (!data?.ok) {
        toast.error(data?.error || (language === "fr" ? "Erreur" : "Error"));
        return;
      }

      setUploadSuccess(true);
      toast.success(language === "fr" 
        ? "Preuve de paiement envoyée avec succès!" 
        : "Payment proof submitted successfully!");
    } catch (err) {
      console.error("Error:", err);
      toast.error(language === "fr" 
        ? "Une erreur est survenue" 
        : "An error occurred");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">
            {language === "fr" ? "Chargement..." : "Loading..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <img src={afrishopLogo} alt="AfriShop" className="h-10 mx-auto mb-4 rounded-lg" />
          <Building2 className="h-12 w-12 mx-auto text-primary" />
          <h1 className="text-2xl font-bold text-foreground">
            {language === "fr" ? "Virement Bancaire" : "Bank Transfer"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {language === "fr" 
              ? "Utilisez les informations ci-dessous pour effectuer votre virement" 
              : "Use the information below to make your transfer"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
            className="text-xs"
          >
            {language === "fr" ? "🇬🇧 English" : "🇫🇷 Français"}
          </Button>
        </div>

        {/* Reference from URL */}
        {refParam && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4">
              <DetailRow
                icon={Hash}
                label={language === "fr" ? "Référence / Order ID" : "Reference / Order ID"}
                value={refParam}
                field="reference"
                highlight
              />
            </CardContent>
          </Card>
        )}

        {/* Bank Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {language === "fr" ? "Informations bancaires" : "Bank Information"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <DetailRow
              icon={User}
              label={language === "fr" ? "Nom du compte (Bénéficiaire)" : "Account Name (Beneficiary)"}
              value={bankDetails?.beneficiary_name}
              field="beneficiary"
            />
            <Separator />
            <DetailRow
              icon={Building2}
              label={language === "fr" ? "Banque" : "Bank"}
              value={bankDetails?.bank_name}
              field="bank_name"
            />
            <Separator />
            <DetailRow
              icon={Hash}
              label={language === "fr" ? "Numéro de compte (23 chiffres)" : "Account Number (23 digits)"}
              value={bankDetails?.account_number_or_iban}
              field="account_number"
            />
            <Separator />
            <div className="flex items-center justify-between py-4 px-3">
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === "fr" ? "Devise" : "Currency"}
                  </p>
                  <p className="font-medium">USD</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-300">
                  {language === "fr" ? "Instructions importantes" : "Important Instructions"}
                </p>
                <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                  {language === "fr" 
                    ? bankDetails?.instructions_fr 
                    : bankDetails?.instructions_en}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload Proof Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {language === "fr" ? "Envoyer la preuve de paiement" : "Upload Payment Proof"}
            </CardTitle>
            <CardDescription>
              {language === "fr" 
                ? "Après avoir effectué le virement, téléchargez la preuve ici"
                : "After making the transfer, upload the proof here"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {uploadSuccess ? (
              <div className="text-center py-8 space-y-4">
                <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
                <div>
                  <h3 className="text-lg font-semibold text-green-700 dark:text-green-400">
                    {language === "fr" ? "Preuve envoyée avec succès!" : "Proof Submitted Successfully!"}
                  </h3>
                  <p className="text-muted-foreground mt-1">
                    {language === "fr" 
                      ? "Nous vérifierons votre paiement et vous contacterons bientôt."
                      : "We will verify your payment and contact you soon."}
                  </p>
                </div>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="reference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {language === "fr" ? "Référence *" : "Reference *"}
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder={language === "fr" ? "Ex: AFRISHOP-12345678" : "E.g: AFRISHOP-12345678"} 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {language === "fr" ? "Votre nom (optionnel)" : "Your Name (optional)"}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="John Doe" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contact"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {language === "fr" ? "Email ou WhatsApp (optionnel)" : "Email or WhatsApp (optional)"}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="email@example.com ou +243..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2">
                    <Label>
                      {language === "fr" ? "Fichier (image ou PDF) *" : "File (image or PDF) *"}
                    </Label>
                    <Input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileChange}
                      className="cursor-pointer"
                    />
                    {selectedFile && (
                      <p className="text-sm text-muted-foreground">
                        {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>

                  <Button type="submit" className="w-full gap-2" disabled={uploading}>
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {language === "fr" ? "Envoi en cours..." : "Uploading..."}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        {language === "fr" ? "Envoyer la preuve" : "Submit Proof"}
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        {/* Support */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {language === "fr" ? "Besoin d'aide?" : "Need help?"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bankDetails?.support_whatsapp && (
              <a
                href={`https://wa.me/${bankDetails.support_whatsapp.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
              >
                <Phone className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-700 dark:text-green-400">WhatsApp</p>
                  <p className="text-sm text-muted-foreground">{bankDetails.support_whatsapp}</p>
                </div>
              </a>
            )}
            {bankDetails?.support_email && (
              <a
                href={`mailto:${bankDetails.support_email}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
              >
                <Mail className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-700 dark:text-blue-400">Email</p>
                  <p className="text-sm text-muted-foreground">{bankDetails.support_email}</p>
                </div>
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicBankTransfer;