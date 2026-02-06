import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Home, RefreshCw, Plus, Trash2, Loader2, Clock, Smartphone, Globe,
  ChevronRight, Settings2, Zap,
} from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Recipe {
  id: string;
  target: string;
  key: string;
  title_en: string | null;
  title_fr: string | null;
  enabled: boolean;
  sort_order: number;
  mode: string;
  min_price_usd: number | null;
  max_price_usd: number | null;
  provider_policy: unknown;
}

interface Seed {
  id: string;
  recipe_id: string;
  query: string;
  weight: number;
  enabled: boolean;
}

interface RefreshSettings {
  env: string;
  mobile_refresh_hours: number;
  web_refresh_hours: number;
  mobile_enabled: boolean;
  web_enabled: boolean;
  mobile_schema_version: number;
  web_schema_version: number;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function HomeRecipes() {
  const { language } = useLanguage();
  const { session } = useAuth();
  const fr = language === "fr";

  // Data
  const [mobileRecipes, setMobileRecipes] = useState<Recipe[]>([]);
  const [webRecipes, setWebRecipes] = useState<Recipe[]>([]);
  const [refreshSettings, setRefreshSettings] = useState<RefreshSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Seed modal
  const [seedModalRecipe, setSeedModalRecipe] = useState<Recipe | null>(null);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [loadingSeeds, setLoadingSeeds] = useState(false);
  const [newSeedQuery, setNewSeedQuery] = useState("");
  const [addingSeed, setAddingSeed] = useState(false);

  // Rebuild states
  const [rebuildingMobile, setRebuildingMobile] = useState(false);
  const [rebuildingWeb, setRebuildingWeb] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Edit fields
  const [mobileHours, setMobileHours] = useState(12);
  const [webHours, setWebHours] = useState(12);

  // ─── FETCH ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [recipesRes, settingsRes] = await Promise.all([
        supabase.from("home_recipes").select("*").order("sort_order"),
        supabase.from("home_refresh_settings").select("*").eq("env", "production").maybeSingle(),
      ]);

      if (recipesRes.data) {
        setMobileRecipes(recipesRes.data.filter((r: Recipe) => r.target === "mobile"));
        setWebRecipes(recipesRes.data.filter((r: Recipe) => r.target === "web"));
      }

      if (settingsRes.data) {
        const s = settingsRes.data as RefreshSettings;
        setRefreshSettings(s);
        setMobileHours(s.mobile_refresh_hours);
        setWebHours(s.web_refresh_hours);
      }
    } catch (err) {
      console.error("Failed to load recipes:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ─── SEEDS MODAL ────────────────────────────────────────────────────────────

  const openSeedModal = async (recipe: Recipe) => {
    setSeedModalRecipe(recipe);
    setSeeds([]);
    setLoadingSeeds(true);
    try {
      const { data } = await supabase
        .from("home_recipe_seeds")
        .select("*")
        .eq("recipe_id", recipe.id)
        .order("weight", { ascending: false });
      setSeeds(data || []);
    } catch {
      // ignore
    } finally {
      setLoadingSeeds(false);
    }
  };

  const addSeed = async () => {
    if (!newSeedQuery.trim() || !seedModalRecipe) return;
    setAddingSeed(true);
    try {
      const { error } = await supabase.from("home_recipe_seeds").insert({
        recipe_id: seedModalRecipe.id,
        query: newSeedQuery.trim(),
        weight: 1,
        enabled: true,
      });
      if (error) throw error;
      setNewSeedQuery("");
      // Refresh seeds
      const { data } = await supabase
        .from("home_recipe_seeds")
        .select("*")
        .eq("recipe_id", seedModalRecipe.id)
        .order("weight", { ascending: false });
      setSeeds(data || []);
      toast({ title: fr ? "Ajouté" : "Added" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAddingSeed(false);
    }
  };

  const deleteSeed = async (seedId: string) => {
    try {
      await supabase.from("home_recipe_seeds").delete().eq("id", seedId);
      setSeeds(prev => prev.filter(s => s.id !== seedId));
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const toggleSeedEnabled = async (seed: Seed) => {
    try {
      await supabase.from("home_recipe_seeds").update({ enabled: !seed.enabled }).eq("id", seed.id);
      setSeeds(prev => prev.map(s => s.id === seed.id ? { ...s, enabled: !s.enabled } : s));
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  // ─── RECIPE TOGGLES ────────────────────────────────────────────────────────

  const toggleRecipe = async (recipe: Recipe) => {
    try {
      await supabase.from("home_recipes").update({ enabled: !recipe.enabled }).eq("id", recipe.id);
      fetchAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  // ─── REBUILD ────────────────────────────────────────────────────────────────

  const rebuild = async (target: "mobile" | "web") => {
    const setRebuilding = target === "mobile" ? setRebuildingMobile : setRebuildingWeb;
    setRebuilding(true);
    try {
      const res = await supabase.functions.invoke("admin-rebuild-home", {
        method: "POST",
        body: { target, env: "production" },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      const d = res.data;
      toast({
        title: fr ? "✓ Reconstruit!" : "✓ Rebuilt!",
        description: `${d.itemCount} items, ${d.sectionCount} ${target === "mobile" ? "sections" : "pages"}, ${d.durationMs}ms`,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || String(err), variant: "destructive" });
    } finally {
      setRebuilding(false);
    }
  };

  // ─── SAVE SETTINGS ──────────────────────────────────────────────────────────

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const { error } = await supabase
        .from("home_refresh_settings")
        .upsert({
          env: "production",
          mobile_refresh_hours: mobileHours,
          web_refresh_hours: webHours,
          mobile_enabled: true,
          web_enabled: true,
          mobile_schema_version: refreshSettings?.mobile_schema_version || 1,
          web_schema_version: refreshSettings?.web_schema_version || 1,
        }, { onConflict: "env" });
      if (error) throw error;
      toast({ title: fr ? "Sauvegardé" : "Saved" });
      fetchAll();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Home className="h-6 w-6" />
          {fr ? "Recettes Accueil" : "Home Recipes"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {fr
            ? "Gérez les produits affichés sur les pages d'accueil mobile et web."
            : "Manage products shown on mobile and web homepages."}
        </p>
      </div>

      {/* Refresh Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {fr ? "Paramètres de Rafraîchissement" : "Refresh Settings"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>{fr ? "Mobile (heures)" : "Mobile (hours)"}</Label>
              <Input
                type="number"
                min={1}
                max={168}
                value={mobileHours}
                onChange={e => setMobileHours(parseInt(e.target.value) || 12)}
              />
            </div>
            <div className="space-y-2">
              <Label>{fr ? "Web (heures)" : "Web (hours)"}</Label>
              <Input
                type="number"
                min={1}
                max={168}
                value={webHours}
                onChange={e => setWebHours(parseInt(e.target.value) || 12)}
              />
            </div>
          </div>
          <Button onClick={saveSettings} disabled={savingSettings} className="mt-4 gap-2">
            {savingSettings && <Loader2 className="h-4 w-4 animate-spin" />}
            {fr ? "Sauvegarder" : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Mobile Homepage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                {fr ? "Accueil Mobile" : "Mobile Homepage"}
              </CardTitle>
              <CardDescription>
                {fr ? `${mobileRecipes.length} sections, rafraîchi toutes les ${mobileHours}h` : `${mobileRecipes.length} sections, refreshed every ${mobileHours}h`}
              </CardDescription>
            </div>
            <Button
              onClick={() => rebuild("mobile")}
              disabled={rebuildingMobile}
              className="gap-2"
            >
              {rebuildingMobile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {fr ? "Reconstruire Mobile" : "Rebuild Mobile Now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {mobileRecipes.map(recipe => (
              <RecipeRow
                key={recipe.id}
                recipe={recipe}
                fr={fr}
                onToggle={() => toggleRecipe(recipe)}
                onEditSeeds={() => openSeedModal(recipe)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Web Homepage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="h-5 w-5" />
                {fr ? "Accueil Web" : "Web Homepage"}
              </CardTitle>
              <CardDescription>
                {fr ? `${webRecipes.length} pages × 100 items, rafraîchi toutes les ${webHours}h` : `${webRecipes.length} pages × 100 items, refreshed every ${webHours}h`}
              </CardDescription>
            </div>
            <Button
              onClick={() => rebuild("web")}
              disabled={rebuildingWeb}
              className="gap-2"
            >
              {rebuildingWeb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {fr ? "Reconstruire Web" : "Rebuild Web Now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {webRecipes.map((recipe, i) => (
              <RecipeRow
                key={recipe.id}
                recipe={recipe}
                fr={fr}
                highlight={i === 0}
                onToggle={() => toggleRecipe(recipe)}
                onEditSeeds={() => openSeedModal(recipe)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Seed Editor Modal */}
      <Dialog open={!!seedModalRecipe} onOpenChange={(open) => { if (!open) setSeedModalRecipe(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              {fr ? "Requêtes pour" : "Seeds for"} {seedModalRecipe ? (fr ? seedModalRecipe.title_fr : seedModalRecipe.title_en) || seedModalRecipe.key : ""}
            </DialogTitle>
            <DialogDescription>
              {fr ? "Chaque requête génère des produits pour cette section." : "Each query fetches products for this section."}
            </DialogDescription>
          </DialogHeader>

          {/* Add seed */}
          <div className="flex gap-2">
            <Input
              placeholder={fr ? "Nouvelle requête..." : "New query..."}
              value={newSeedQuery}
              onChange={e => setNewSeedQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSeed()}
            />
            <Button onClick={addSeed} disabled={addingSeed || !newSeedQuery.trim()} size="icon">
              {addingSeed ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          <Separator />

          {/* Seed list */}
          <ScrollArea className="max-h-[400px]">
            {loadingSeeds ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : seeds.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {fr ? "Aucune requête" : "No seeds yet"}
              </p>
            ) : (
              <div className="space-y-1">
                {seeds.map(seed => (
                  <div key={seed.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50">
                    <Switch
                      checked={seed.enabled}
                      onCheckedChange={() => toggleSeedEnabled(seed)}
                    />
                    <span className={`flex-1 text-sm ${!seed.enabled ? "text-muted-foreground line-through" : ""}`}>
                      {seed.query}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deleteSeed(seed.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── SUB-COMPONENT ────────────────────────────────────────────────────────────

function RecipeRow({
  recipe,
  fr,
  highlight,
  onToggle,
  onEditSeeds,
}: {
  recipe: Recipe;
  fr: boolean;
  highlight?: boolean;
  onToggle: () => void;
  onEditSeeds: () => void;
}) {
  const title = (fr ? recipe.title_fr : recipe.title_en) || recipe.key;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${highlight ? "border-primary bg-primary/5" : "border-border"}`}>
      <Switch checked={recipe.enabled} onCheckedChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{title}</span>
          <Badge variant="outline" className="text-xs">{recipe.key}</Badge>
          {highlight && <Badge className="text-xs">{fr ? "Important" : "Most Important"}</Badge>}
        </div>
        {(recipe.min_price_usd || recipe.max_price_usd) && (
          <span className="text-xs text-muted-foreground">
            {recipe.min_price_usd ? `$${recipe.min_price_usd}+` : ""}
            {recipe.max_price_usd ? ` ≤$${recipe.max_price_usd}` : ""}
          </span>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onEditSeeds} className="gap-1">
        {fr ? "Requêtes" : "Seeds"}
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
