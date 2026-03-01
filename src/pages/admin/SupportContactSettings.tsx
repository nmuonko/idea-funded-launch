import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save, Phone, Mail, Headphones } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";

const supportContactSchema = z.object({
  support_whatsapp: z.string().optional(),
  support_email: z.string().email("Invalid email").optional().or(z.literal("")),
});

type SupportContactForm = z.infer<typeof supportContactSchema>;

const SupportContactSettings = () => {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const form = useForm<SupportContactForm>({
    resolver: zodResolver(supportContactSchema),
    defaultValues: {
      support_whatsapp: "",
      support_email: "",
    },
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from("settings")
          .select("support_whatsapp, support_email")
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("Error fetching support settings:", error);
          toast.error(language === 'fr' ? "Échec du chargement" : "Failed to load settings");
          return;
        }

        if (data) {
          form.reset({
            support_whatsapp: data.support_whatsapp || "",
            support_email: data.support_email || "",
          });
        }
      } catch (err) {
        console.error("Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [form, language]);

  const onSubmit = async (values: SupportContactForm) => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("settings")
        .select("id")
        .limit(1)
        .maybeSingle();

      let error;
      if (existing?.id) {
        const result = await supabase
          .from("settings")
          .update({
            support_whatsapp: values.support_whatsapp,
            support_email: values.support_email,
          })
          .eq("id", existing.id);
        error = result.error;
      }

      if (error) {
        console.error("Error saving support settings:", error);
        toast.error(language === 'fr' ? "Échec de la sauvegarde" : "Failed to save settings");
        return;
      }

      // Also sync to bank_transfer_settings so mobile app stays in sync
      const { data: bankSettings } = await supabase
        .from("bank_transfer_settings")
        .select("id")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (bankSettings?.id) {
        await supabase
          .from("bank_transfer_settings")
          .update({
            support_whatsapp: values.support_whatsapp,
            support_email: values.support_email,
          })
          .eq("id", bankSettings.id);
      }

      toast.success(language === 'fr' ? "Contact support sauvegardé" : "Support contact saved successfully");
    } catch (err) {
      console.error("Error:", err);
      toast.error(language === 'fr' ? "Une erreur s'est produite" : "An error occurred");
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
          <Headphones className="h-6 w-6" />
          {language === 'fr' ? 'Contact Support' : 'Support Contact'}
        </h2>
        <p className="text-muted-foreground mt-1">
          {language === 'fr' 
            ? 'Configurez les informations de contact pour le support client. Ces informations seront affichées dans l\'application mobile et sur le site web.'
            : 'Configure customer support contact information. This will be displayed in the mobile app and website.'}
        </p>
      </div>

      <Alert>
        <Phone className="h-4 w-4" />
        <AlertDescription>
          {language === 'fr'
            ? 'Ces informations sont utilisées par l\'application mobile et le site web pour afficher les options de contact du support.'
            : 'This information is used by the mobile app and website to display support contact options.'}
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'fr' ? 'Informations de Contact' : 'Contact Information'}
              </CardTitle>
              <CardDescription>
                {language === 'fr'
                  ? 'Comment les clients peuvent vous joindre pour obtenir de l\'aide'
                  : 'How customers can reach you for help'}
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
                      {language === 'fr' ? 'Numéro WhatsApp' : 'WhatsApp Number'}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="243973141627" {...field} />
                    </FormControl>
                    <FormDescription>
                      {language === 'fr'
                        ? 'Incluez l\'indicatif du pays sans + ni espaces (ex: 243 pour la RDC)'
                        : 'Include country code without + or spaces (e.g., 243 for DR Congo)'}
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
                      {language === 'fr' ? 'Email Support' : 'Support Email'}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="support@afrishop-usa.com" type="email" {...field} />
                    </FormControl>
                    <FormDescription>
                      {language === 'fr'
                        ? 'Adresse email pour les demandes de support client'
                        : 'Email address for customer support inquiries'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {language === 'fr' ? 'Sauvegarder' : 'Save Settings'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default SupportContactSettings;
