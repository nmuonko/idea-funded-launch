import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, DollarSign, Headphones } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

// Import the content from existing pages
import PaymentProvidersContent from "./PaymentProvidersContent";
import PaymentLimitsContent from "./PaymentLimitsContent";
import SupportContactSettings from "./SupportContactSettings";

export default function PaymentsSettings() {
  const { language } = useLanguage();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {language === 'fr' ? 'Paramètres de Paiement' : 'Payment Settings'}
        </h1>
        <p className="text-muted-foreground">
          {language === 'fr' 
            ? 'Gérez les fournisseurs de paiement, les limites et le contact support' 
            : 'Manage payment providers, limits, and support contact'}
        </p>
      </div>

      <Tabs defaultValue="providers" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="providers" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            {language === 'fr' ? 'Fournisseurs' : 'Providers'}
          </TabsTrigger>
          <TabsTrigger value="limits" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            {language === 'fr' ? 'Limites' : 'Limits'}
          </TabsTrigger>
          <TabsTrigger value="support" className="flex items-center gap-2">
            <Headphones className="h-4 w-4" />
            {language === 'fr' ? 'Support' : 'Support'}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="mt-6">
          <PaymentProvidersContent />
        </TabsContent>

        <TabsContent value="limits" className="mt-6">
          <PaymentLimitsContent />
        </TabsContent>

        <TabsContent value="support" className="mt-6">
          <SupportContactSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
