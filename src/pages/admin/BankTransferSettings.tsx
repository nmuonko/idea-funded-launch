import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save, Building2, Phone, Mail, FileText, AlertCircle, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const bankDetailsSchema = z.object({
  beneficiary_name: z.string().min(1, "Required"),
  bank_name: z.string().min(1, "Required"),
  account_number_or_iban: z.string().min(1, "Required"),
  swift_bic: z.string().optional(),
  instructions_fr: z.string().optional(),
  instructions_en: z.string().optional(),
  support_whatsapp: z.string().optional(),
  support_email: z.string().email().optional().or(z.literal("")),
});

type BankDetailsForm = z.infer<typeof bankDetailsSchema>;

const BankTransferSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const form = useForm<BankDetailsForm>({
    resolver: zodResolver(bankDetailsSchema),
    defaultValues: {
      beneficiary_name: "",
      bank_name: "",
      account_number_or_iban: "",
      swift_bic: "",
      instructions_fr: "",
      instructions_en: "",
      support_whatsapp: "",
      support_email: "",
    },
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "bank_transfer_details")
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("Error fetching bank settings:", error);
          toast.error("Failed to load settings");
          return;
        }

        if (data?.value) {
          const parsed = typeof data.value === "string" 
            ? JSON.parse(data.value) 
            : data.value;
          form.reset({
            beneficiary_name: parsed.beneficiary_name || "",
            bank_name: parsed.bank_name || "",
            account_number_or_iban: parsed.account_number_or_iban || "",
            swift_bic: parsed.swift_bic || "",
            instructions_fr: parsed.instructions_fr || "",
            instructions_en: parsed.instructions_en || "",
            support_whatsapp: parsed.support_whatsapp || "",
            support_email: parsed.support_email || "",
          });
        }
      } catch (err) {
        console.error("Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [form]);

  const onSubmit = async (values: BankDetailsForm) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("admin_settings")
        .upsert({
          key: "bank_transfer_details",
          value: JSON.stringify(values),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "key",
        });

      if (error) {
        console.error("Error saving bank settings:", error);
        toast.error("Failed to save settings");
        return;
      }

      toast.success("Bank transfer settings saved successfully");
    } catch (err) {
      console.error("Error:", err);
      toast.error("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="h-6 w-6" />
          Bank Transfer Settings
        </h2>
        <p className="text-muted-foreground mt-1">
          Configure bank details for manual wire transfers. These will be shown to customers on the secure payment page.
        </p>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          These settings are used when generating secure bank transfer links for large payments. 
          The link is valid for 24 hours and can only be accessed with a valid token.
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Bank Account Information</CardTitle>
              <CardDescription>
                Enter your company's bank account details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="beneficiary_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beneficiary Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="AfriShop USA LLC" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bank_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Bank of America" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="account_number_or_iban"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number / IBAN *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter account number or IBAN" {...field} />
                    </FormControl>
                    <FormDescription>
                      This is the main account identifier customers will use for transfers
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="swift_bic"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SWIFT / BIC Code</FormLabel>
                    <FormControl>
                      <Input placeholder="BOFAUS3N" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Instructions
              </CardTitle>
              <CardDescription>
                Provide clear instructions for customers in both languages
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="instructions_fr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instructions (Français)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Mettez la référence dans le libellé du virement." 
                        className="min-h-[80px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="instructions_en"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instructions (English)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Please include the reference number in the transfer description." 
                        className="min-h-[80px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Support Contact</CardTitle>
              <CardDescription>
                How customers can reach you for help with their transfer
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="support_whatsapp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      WhatsApp Number
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="+1234567890" {...field} />
                    </FormControl>
                    <FormDescription>
                      Include country code (e.g., +243 for DR Congo)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="support_email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Support Email
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="support@afrishop-usa.com" type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        </form>
      </Form>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Test the Bank Transfer Page</CardTitle>
          <CardDescription>
            Once saved, the bank transfer page will use these settings. 
            Links are generated automatically when customers choose bank transfer for large payments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ExternalLink className="h-4 w-4" />
            <span>
              Page URL format: <code className="bg-muted px-1 rounded">/bank-transfer?t=TOKEN</code>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BankTransferSettings;
