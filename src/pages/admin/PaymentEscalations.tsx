import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentPlanCTAPanel } from "@/components/admin/PaymentPlanCTAPanel";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, MessageSquare, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface Escalation {
  id: string;
  conversation_id: string | null;
  customer_message: string;
  bot_answer: string | null;
  reason: string;
  product_id: string | null;
  product_title: string | null;
  status: string;
  resolution_note: string | null;
  created_at: string;
  metadata: any;
}

interface CtaStats {
  cta_type: string;
  channel: string;
  count: number;
}

export default function PaymentEscalations() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [stats, setStats] = useState<CtaStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const [escRes, clicksRes] = await Promise.all([
      supabase
        .from("chatbot_payment_escalations")
        .select("*")
        .eq("status", statusFilter)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("payment_cta_clicks")
        .select("cta_type, channel")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
        .limit(5000),
    ]);
    setEscalations((escRes.data as any) || []);
    const buckets: Record<string, CtaStats> = {};
    (clicksRes.data || []).forEach((r: any) => {
      const k = `${r.cta_type}|${r.channel}`;
      if (!buckets[k]) buckets[k] = { cta_type: r.cta_type, channel: r.channel, count: 0 };
      buckets[k].count += 1;
    });
    setStats(Object.values(buckets).sort((a, b) => b.count - a.count));
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("payment-escalations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chatbot_payment_escalations" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function resolve(id: string, status: "resolved" | "dismissed" | "in_progress") {
    const { error } = await supabase
      .from("chatbot_payment_escalations")
      .update({
        status,
        resolution_note: notes[id] || null,
        resolved_at: status === "resolved" || status === "dismissed" ? new Date().toISOString() : null,
      })
      .eq("id", id);
    if (error) {
      toast.error("Mise à jour impossible");
      return;
    }
    toast.success("Escalade mise à jour");
    load();
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          Escalades paiement de Sophie
        </h1>
        <p className="text-sm text-muted-foreground">
          Conversations où Sophie n'a pas pu proposer une étape de paiement
          actionnable. Plus elles s'accumulent, plus nous perdons de clients.
        </p>
      </div>

      {/* CTA analytics summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            Clics CTA paiement (7 derniers jours)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun clic enregistré.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {stats.map((s) => (
                <div key={`${s.cta_type}-${s.channel}`} className="rounded-lg border p-3">
                  <div className="text-2xl font-bold">{s.count}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {s.cta_type.replace(/_/g, " ")}
                  </div>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {s.channel}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick share panel */}
      <PaymentPlanCTAPanel />

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {["open", "in_progress", "resolved", "dismissed"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {/* Escalation list */}
      <div className="space-y-3">
        {loading && <Skeleton className="h-40 w-full" />}
        {!loading && escalations.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground text-sm">
              Aucune escalade {statusFilter}.
            </CardContent>
          </Card>
        )}
        {escalations.map((e) => (
          <Card key={e.id} className="border-amber-500/30">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-amber-500" />
                  <Badge variant="destructive">{e.reason}</Badge>
                  {e.product_title && (
                    <Badge variant="secondary">{e.product_title}</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: fr })}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <div className="text-[11px] uppercase text-muted-foreground mb-1">Client</div>
                {e.customer_message}
              </div>
              {e.bot_answer && (
                <div className="rounded-md bg-muted/20 p-3 text-sm border-l-2 border-emerald-500/40">
                  <div className="text-[11px] uppercase text-muted-foreground mb-1">Sophie</div>
                  {e.bot_answer}
                </div>
              )}
              {statusFilter !== "resolved" && statusFilter !== "dismissed" && (
                <>
                  <Textarea
                    rows={2}
                    placeholder="Note de résolution (ex: Plan 30/70 envoyé via WhatsApp)..."
                    value={notes[e.id] || ""}
                    onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                  />
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" onClick={() => resolve(e.id, "resolved")}>
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      Résolu
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolve(e.id, "in_progress")}>
                      En cours
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolve(e.id, "dismissed")}>
                      Ignorer
                    </Button>
                    {e.conversation_id && (
                      <Button asChild size="sm" variant="link">
                        <a href={`/admin/chatbot-conversations?id=${e.conversation_id}`}>
                          Voir la conversation
                        </a>
                      </Button>
                    )}
                  </div>
                </>
              )}
              {e.resolution_note && (
                <div className="text-xs text-muted-foreground italic">
                  Note : {e.resolution_note}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
