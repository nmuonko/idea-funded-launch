import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Settings {
  id?: string;
  electronics_refresh_minutes: number;
  cart_item_refresh_minutes: number;
  hot_item_refresh_minutes: number;
  normal_refresh_minutes: number;
  cold_refresh_minutes: number;
  lock_minutes_electronics: number;
  lock_minutes_normal: number;
  allow_checkout_on_verify_fail: boolean;
  max_supplier_delta_pct: number;
}

const DEFAULT: Settings = {
  electronics_refresh_minutes: 45,
  cart_item_refresh_minutes: 20,
  hot_item_refresh_minutes: 30,
  normal_refresh_minutes: 240,
  cold_refresh_minutes: 1080,
  lock_minutes_electronics: 30,
  lock_minutes_normal: 60,
  allow_checkout_on_verify_fail: false,
  max_supplier_delta_pct: 25,
};

interface Anomaly {
  id: string;
  product_key: string | null;
  marketplace: string | null;
  previous_source_price_usd: number | null;
  new_source_price_usd: number | null;
  delta_pct: number | null;
  detected_at: string;
}

export default function PriceValidation() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);

  useEffect(() => {
    (async () => {
      const [s, a] = await Promise.all([
        supabase.from("price_validation_settings").select("*").limit(1).maybeSingle(),
        supabase.from("price_anomalies").select("*").order("detected_at", { ascending: false }).limit(50),
      ]);
      if (s.data) setSettings(s.data as Settings);
      if (a.data) setAnomalies(a.data as Anomaly[]);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("price_validation_settings")
      .update({
        electronics_refresh_minutes: settings.electronics_refresh_minutes,
        cart_item_refresh_minutes: settings.cart_item_refresh_minutes,
        hot_item_refresh_minutes: settings.hot_item_refresh_minutes,
        normal_refresh_minutes: settings.normal_refresh_minutes,
        cold_refresh_minutes: settings.cold_refresh_minutes,
        lock_minutes_electronics: settings.lock_minutes_electronics,
        lock_minutes_normal: settings.lock_minutes_normal,
        allow_checkout_on_verify_fail: settings.allow_checkout_on_verify_fail,
        max_supplier_delta_pct: settings.max_supplier_delta_pct,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id!);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Save failed", description: error.message });
    } else {
      toast({ title: "Saved", description: "Price validation settings updated." });
    }
  };

  const num = (k: keyof Settings) => (
    <Input
      type="number"
      value={settings[k] as number}
      onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) })}
    />
  );

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Price Validation</h1>
        <p className="text-muted-foreground text-sm">
          Refresh intervals + cart lock durations. The backend uses these to decide when
          to re-verify supplier prices and how long to reserve the price for a customer.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Background refresh intervals (minutes)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Cart items</Label>{num("cart_item_refresh_minutes")}</div>
          <div><Label>Hot products</Label>{num("hot_item_refresh_minutes")}</div>
          <div><Label>Electronics / phones</Label>{num("electronics_refresh_minutes")}</div>
          <div><Label>Normal products</Label>{num("normal_refresh_minutes")}</div>
          <div><Label>Cold (low traffic)</Label>{num("cold_refresh_minutes")}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cart price lock duration (minutes)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Electronics / cart / hot</Label>{num("lock_minutes_electronics")}</div>
          <div><Label>Normal products</Label>{num("lock_minutes_normal")}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Safety</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Max supplier delta before emergency hide (%)</Label>
            {num("max_supplier_delta_pct")}
            <p className="text-xs text-muted-foreground mt-1">
              When a refresh detects a supplier price jump larger than this, the product is
              auto-flagged for admin review and hidden from feeds.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Allow checkout on verification failure</Label>
              <p className="text-xs text-muted-foreground">
                Default OFF — protects against locking a stale price.
              </p>
            </div>
            <Switch
              checked={settings.allow_checkout_on_verify_fail}
              onCheckedChange={(v) => setSettings({ ...settings, allow_checkout_on_verify_fail: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
        Save settings
      </Button>

      <Card>
        <CardHeader><CardTitle>Recent price anomalies</CardTitle></CardHeader>
        <CardContent>
          {anomalies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No anomalies recorded yet.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {anomalies.map((a) => (
                <div key={a.id} className="flex justify-between border-b pb-2">
                  <span>{a.marketplace} · {a.product_key}</span>
                  <span>
                    ${a.previous_source_price_usd?.toFixed(2)} → ${a.new_source_price_usd?.toFixed(2)}
                    {" "}({a.delta_pct?.toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
