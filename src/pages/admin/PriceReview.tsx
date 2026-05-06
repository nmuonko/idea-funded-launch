import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw, Check, X, ExternalLink } from "lucide-react";

interface FlaggedItem {
  id: string;
  title: string | null;
  provider: string | null;
  product_url: string | null;
  image_url: string | null;
  price_usd: number | null;
  last_known_live_price_usd: number | null;
  price_drift_pct: number | null;
  last_price_check_at: string | null;
}

export default function PriceReview() {
  const [items, setItems] = useState<FlaggedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("catalog_items")
      .select(
        "id, title, provider, product_url, image_url, price_usd, last_known_live_price_usd, price_drift_pct, last_price_check_at",
      )
      .eq("needs_price_review", true)
      .order("last_price_check_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setItems((data as FlaggedItem[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const approveNew = async (item: FlaggedItem) => {
    if (!item.last_known_live_price_usd) return;
    setBusyId(item.id);
    const { error } = await supabase
      .from("catalog_items")
      .update({
        price_usd: item.last_known_live_price_usd,
        needs_price_review: false,
        price_check_status: "admin_approved",
        price_updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    setBusyId(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Price updated");
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    }
  };

  const keepOld = async (item: FlaggedItem) => {
    setBusyId(item.id);
    const { error } = await supabase
      .from("catalog_items")
      .update({
        needs_price_review: false,
        price_check_status: "admin_kept_old",
      })
      .eq("id", item.id);
    setBusyId(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Kept current price");
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    }
  };

  const recheck = async (item: FlaggedItem) => {
    setBusyId(item.id);
    const { data, error } = await supabase.functions.invoke("price-checker", {
      body: { mode: "single", itemId: item.id },
    });
    setBusyId(null);
    if (error) toast.error(error.message);
    else {
      toast.success(`Rechecked: ${(data as any)?.results?.[0]?.action || "done"}`);
      load();
    }
  };

  const runScan = async () => {
    setScanning(true);
    const { error } = await supabase.functions.invoke("price-checker", {
      body: { mode: "cron", limit: 50, staleHours: 1 },
    });
    setScanning(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Scan triggered");
      load();
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Price Review</h1>
          <p className="text-sm text-muted-foreground">
            Items where the live store price differs significantly from the saved price.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Run scan now
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No flagged items. Prices are healthy. ✅
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const drift = item.price_drift_pct ? (item.price_drift_pct * 100).toFixed(1) : "—";
            const direction =
              item.last_known_live_price_usd && item.price_usd
                ? item.last_known_live_price_usd > item.price_usd
                  ? "increased"
                  : "decreased"
                : null;
            return (
              <Card key={item.id} className="p-4 flex gap-4 items-center">
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-20 h-20 object-contain rounded bg-muted"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">{item.provider}</Badge>
                    <Badge variant={direction === "increased" ? "destructive" : "secondary"}>
                      {drift}% {direction || "drift"}
                    </Badge>
                  </div>
                  <p className="font-medium truncate">{item.title || "Untitled"}</p>
                  <div className="flex items-center gap-4 text-sm mt-1">
                    <span>
                      Saved: <strong>${item.price_usd?.toFixed(2)}</strong>
                    </span>
                    <span>
                      Live:{" "}
                      <strong>
                        {item.last_known_live_price_usd
                          ? `$${item.last_known_live_price_usd.toFixed(2)}`
                          : "—"}
                      </strong>
                    </span>
                    {item.product_url && (
                      <a
                        href={item.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex items-center gap-1"
                      >
                        Source <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    onClick={() => approveNew(item)}
                    disabled={busyId === item.id || !item.last_known_live_price_usd}
                  >
                    <Check className="h-4 w-4 mr-1" /> Use live price
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => keepOld(item)} disabled={busyId === item.id}>
                    <X className="h-4 w-4 mr-1" /> Keep saved
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => recheck(item)} disabled={busyId === item.id}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Recheck
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
