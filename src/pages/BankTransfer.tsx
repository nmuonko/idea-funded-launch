import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Copy, Check, AlertCircle, Phone, Mail, Loader2, CreditCard, Building2, User, Hash, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface OrderInfo {
  order_id: string;
  reference: string;
  amount_usd: number;
  amount_cdf: number;
  currency: string;
  customer_name: string | null;
  status: string;
}

interface BankInfo {
  beneficiary_name: string;
  bank_name: string;
  account_number_or_iban: string;
  swift_bic: string;
  instructions_fr: string;
  instructions_en: string;
  support_whatsapp: string;
  support_email: string;
}

interface ViewData {
  ok: boolean;
  order?: OrderInfo;
  bank?: BankInfo;
  expires_at?: string;
  error?: string;
  error_en?: string;
}

const BankTransfer = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t");
  
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ViewData | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [language, setLanguage] = useState<"fr" | "en">("fr");

  useEffect(() => {
    const fetchData = async () => {
      if (!token) {
        setData({ ok: false, error: "Lien invalide", error_en: "Invalid link" });
        setLoading(false);
        return;
      }

      try {
        const { data: result, error } = await supabase.functions.invoke("get-bank-transfer-view", {
          body: { t: token },
        });

        if (error) {
          console.error("Error fetching bank transfer view:", error);
          setData({ ok: false, error: "Erreur de chargement", error_en: "Loading error" });
        } else {
          setData(result);
        }
      } catch (err) {
        console.error("Error:", err);
        setData({ ok: false, error: "Erreur de connexion", error_en: "Connection error" });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

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

  const copyAllDetails = () => {
    if (!data?.order || !data?.bank) return;

    const allText = [
      `--- ${language === "fr" ? "VIREMENT BANCAIRE" : "BANK TRANSFER"} ---`,
      "",
      `${language === "fr" ? "Référence" : "Reference"}: ${data.order.reference}`,
      `${language === "fr" ? "Montant" : "Amount"}: $${data.order.amount_usd?.toFixed(2) || "0.00"} USD`,
      data.order.amount_cdf ? `${language === "fr" ? "Montant CDF" : "Amount CDF"}: ${data.order.amount_cdf?.toLocaleString()} CDF` : null,
      "",
      `${language === "fr" ? "Bénéficiaire" : "Beneficiary"}: ${data.bank.beneficiary_name}`,
      `${language === "fr" ? "Banque" : "Bank"}: ${data.bank.bank_name}`,
      `IBAN / ${language === "fr" ? "Compte" : "Account"}: ${data.bank.account_number_or_iban}`,
      `SWIFT/BIC: ${data.bank.swift_bic}`,
      "",
      `${language === "fr" ? "Instructions" : "Instructions"}: ${language === "fr" ? data.bank.instructions_fr : data.bank.instructions_en}`,
    ].filter(Boolean).join("\n");

    copyToClipboard(allText, "all");
  };

  const CopyButton = ({ value, field, label }: { value: string; field: string; label?: string }) => (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 shrink-0"
      onClick={() => copyToClipboard(value, field)}
      disabled={!value}
    >
      {copiedField === field ? (
        <>
          <Check className="h-4 w-4 text-green-500" />
          <span className="hidden sm:inline">{language === "fr" ? "Copié!" : "Copied!"}</span>
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" />
          <span className="hidden sm:inline">{label || (language === "fr" ? "Copier" : "Copy")}</span>
        </>
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

  if (!data?.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {language === "fr" ? data?.error : data?.error_en}
              </AlertDescription>
            </Alert>
            <div className="mt-4 text-center">
              <Button
                variant="outline"
                onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
              >
                {language === "fr" ? "English" : "Français"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { order, bank } = data;

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <CreditCard className="h-12 w-12 mx-auto text-primary" />
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

        {/* Order Details */}
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Hash className="h-5 w-5" />
              {language === "fr" ? "Détails de la commande" : "Order Details"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <DetailRow
              icon={Hash}
              label={language === "fr" ? "Référence (IMPORTANT)" : "Reference (IMPORTANT)"}
              value={order?.reference}
              field="reference"
              highlight
            />
            <DetailRow
              icon={CreditCard}
              label={language === "fr" ? "Montant USD" : "Amount USD"}
              value={order?.amount_usd ? `$${order.amount_usd.toFixed(2)}` : undefined}
              field="amount_usd"
              highlight
            />
            {order?.amount_cdf && (
              <DetailRow
                icon={CreditCard}
                label={language === "fr" ? "Montant CDF" : "Amount CDF"}
                value={`${order.amount_cdf.toLocaleString()} CDF`}
                field="amount_cdf"
              />
            )}
          </CardContent>
        </Card>

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
              label={language === "fr" ? "Bénéficiaire" : "Beneficiary"}
              value={bank?.beneficiary_name}
              field="beneficiary"
            />
            <Separator />
            <DetailRow
              icon={Building2}
              label={language === "fr" ? "Banque" : "Bank"}
              value={bank?.bank_name}
              field="bank_name"
            />
            <Separator />
            <DetailRow
              icon={Hash}
              label="IBAN / Compte"
              value={bank?.account_number_or_iban}
              field="iban"
            />
            <Separator />
            <DetailRow
              icon={FileText}
              label="SWIFT / BIC"
              value={bank?.swift_bic}
              field="swift"
            />
          </CardContent>
        </Card>

        {/* Instructions */}
        {(bank?.instructions_fr || bank?.instructions_en) && (
          <Card className="bg-amber-500/10 border-amber-500/30">
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-700 dark:text-amber-300">
                    {language === "fr" ? "Instructions importantes" : "Important Instructions"}
                  </p>
                  <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                    {language === "fr" ? bank?.instructions_fr : bank?.instructions_en}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Copy All Button */}
        <Button
          className="w-full gap-2 h-14 text-lg"
          size="lg"
          onClick={copyAllDetails}
        >
          <Copy className="h-5 w-5" />
          {language === "fr" ? "Copier toutes les informations" : "Copy All Information"}
        </Button>

        {/* Support */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {language === "fr" ? "Besoin d'aide?" : "Need help?"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bank?.support_whatsapp && (
              <a
                href={`https://wa.me/${bank.support_whatsapp.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
              >
                <Phone className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-700 dark:text-green-400">WhatsApp</p>
                  <p className="text-sm text-muted-foreground">{bank.support_whatsapp}</p>
                </div>
              </a>
            )}
            {bank?.support_email && (
              <a
                href={`mailto:${bank.support_email}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
              >
                <Mail className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-700 dark:text-blue-400">Email</p>
                  <p className="text-sm text-muted-foreground">{bank.support_email}</p>
                </div>
              </a>
            )}
          </CardContent>
        </Card>

        {/* Expiry Notice */}
        {data.expires_at && (
          <p className="text-center text-xs text-muted-foreground">
            {language === "fr" 
              ? `Ce lien expire le ${new Date(data.expires_at).toLocaleDateString("fr-FR", { dateStyle: "medium" })} à ${new Date(data.expires_at).toLocaleTimeString("fr-FR", { timeStyle: "short" })}`
              : `This link expires on ${new Date(data.expires_at).toLocaleDateString("en-US", { dateStyle: "medium" })} at ${new Date(data.expires_at).toLocaleTimeString("en-US", { timeStyle: "short" })}`
            }
          </p>
        )}
      </div>
    </div>
  );
};

export default BankTransfer;
