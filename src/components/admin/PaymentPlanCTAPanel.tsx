import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Copy, Send, CreditCard, Wallet } from "lucide-react";

/**
 * Admin-facing 30/70 installment CTA panel.
 * Lets staff compute deposit/balance, copy a payment plan message, or send the
 * customer a tracked link. Every action logs to payment_cta_clicks for analytics.
 */
export function PaymentPlanCTAPanel(props: {
  orderId?: string | null;
  conversationId?: string | null;
  customerUserId?: string | null;
  productTitle?: string | null;
  productUrl?: string | null;
  totalUsd?: number | null;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const [total, setTotal] = useState<string>(
    props.totalUsd != null ? String(props.totalUsd) : ""
  );
  const [productUrl, setProductUrl] = useState<string>(props.productUrl ?? "");
  const [productTitle, setProductTitle] = useState<string>(props.productTitle ?? "");
  const [note, setNote] = useState<string>("");

  const totalNum = Number(total) || 0;
  const deposit = totalNum > 0 ? Math.ceil(totalNum * 0.3) : 0;
  const balance = totalNum > 0 ? Math.ceil(totalNum * 0.7) : 0;

  async function track(cta: "plan_explained" | "admin_share_plan" | "deposit_30" | "full_100") {
    try {
      await supabase.functions.invoke("track-payment-cta", {
        body: {
          cta_type: cta,
          channel: "admin_portal",
          actor_role: "admin",
          conversation_id: props.conversationId ?? null,
          order_id: props.orderId ?? null,
          product_title: productTitle || null,
          product_url: productUrl || null,
          amount_usd: cta === "deposit_30" ? deposit : cta === "full_100" ? totalNum : totalNum,
          metadata: {
            customer_user_id: props.customerUserId ?? null,
            admin_email: user?.email ?? null,
            note: note || null,
          },
        },
      });
    } catch (e) {
      console.warn("track-payment-cta failed", e);
    }
  }

  const planMessage = totalNum > 0
    ? `Bonjour ! Voici le plan de paiement pour ${productTitle || "votre commande"} :\n\n• Acompte 30% aujourd'hui : ${deposit} USD\n• Solde 70% à la livraison : ${balance} USD\n• Total tout compris : ${totalNum} USD\n\n${productUrl ? `Lien de paiement : ${productUrl}\n` : ""}${note ? `\n${note}` : ""}`
    : `Plan de paiement : 30% d'acompte maintenant + 70% à la livraison. Tout est inclus dans le prix.`;

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(planMessage);
      toast.success("Message copié");
      track("admin_share_plan");
    } catch {
      toast.error("Copie impossible");
    }
  }

  async function sharePlan() {
    track("plan_explained");
    toast.success("Plan partagé — événement journalisé");
  }

  return (
    <Card className="border-emerald-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-emerald-500" />
          Plan de paiement 30% / 70%
          <Badge variant="secondary" className="ml-auto">Acompte + livraison</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!props.compact && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cta-product">Produit</Label>
              <Input id="cta-product" value={productTitle} onChange={(e) => setProductTitle(e.target.value)} placeholder="iPhone 15 Pro 128 Go" />
            </div>
            <div>
              <Label htmlFor="cta-total">Total USD (tout compris)</Label>
              <Input id="cta-total" type="number" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="1200" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cta-url">Lien de paiement / commande</Label>
              <Input id="cta-url" value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cta-note">Note pour le client (optionnel)</Label>
              <Textarea id="cta-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Confirmez l'acompte avant 18h..." />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">Acompte 30%</div>
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {totalNum > 0 ? `${deposit} USD` : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">aujourd'hui</div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">Solde 70%</div>
            <div className="text-lg font-bold">
              {totalNum > 0 ? `${balance} USD` : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">à la livraison</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="default" className="bg-emerald-600 hover:bg-emerald-700" onClick={copyPlan}>
            <Copy className="w-4 h-4 mr-1.5" />
            Copier le message
          </Button>
          <Button size="sm" variant="secondary" onClick={sharePlan}>
            <Send className="w-4 h-4 mr-1.5" />
            Marquer comme partagé
          </Button>
          {productUrl && (
            <Button asChild size="sm" variant="outline" onClick={() => track("deposit_30")}>
              <a href={productUrl} target="_blank" rel="noreferrer">
                <Wallet className="w-4 h-4 mr-1.5" />
                Ouvrir paiement acompte
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default PaymentPlanCTAPanel;
