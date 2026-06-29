import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuthenticatedApi } from "@/hooks/useAuthenticatedApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  ChevronRight, Settings2, Zap, Sparkles, CheckCircle2, AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { clearCatalogHomeCache } from "@/lib/catalogCache";
import { HomepagePinnedItems } from "@/components/admin/HomepagePinnedItems";

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
  sort_order: number;
  max_items: number;
  required_terms: string[];
  excluded_terms: string[];
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
  const { post, get } = useAuthenticatedApi();
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingSeedId, setEditingSeedId] = useState<string | null>(null);

  // Rebuild states - track which specific key is rebuilding (or "all_mobile"/"all_web")
  const [rebuildingKey, setRebuildingKey] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Prewarm states
  const [publishing, setPublishing] = useState(false);
  const [publishingSection, setPublishingSection] = useState<string | null>(null);
  const [lastPrewarmJob, setLastPrewarmJob] = useState<{ status: string; completed_at: string | null; rotation_key: string; sections_completed: number; mixed_total: number } | null>(null);

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

  useEffect(() => { fetchAll(); fetchLastPrewarmJob(); }, [fetchAll]);

  // ─── PREWARM (Publish Now) ─────────────────────────────────────────────────

  const fetchLastPrewarmJob = async () => {
    try {
      const response = await get("catalog-service?action=prewarm&sub=status");
      if (response.data?.lastJob) {
        setLastPrewarmJob(response.data.lastJob);
      }
    } catch {
      // ignore
    }
  };

  const handlePublishNow = async (sectionKey?: string) => {
    if (sectionKey) {
      setPublishingSection(sectionKey);
    } else {
      setPublishing(true);
    }
    try {
      const body: Record<string, unknown> = {};
      if (sectionKey) body.sectionKey = sectionKey;
      const response = await post("catalog-service?action=prewarm", body);
      if (response.data?.ok) {
        toast({ 
          title: fr ? "Publication lancée" : "Publishing started", 
          description: sectionKey 
            ? `Section: ${sectionKey}` 
            : `Job: ${response.data.jobId}` 
        });
        clearCatalogHomeCache();
        setTimeout(fetchLastPrewarmJob, 3000);
        setTimeout(fetchLastPrewarmJob, 8000);
        setTimeout(fetchLastPrewarmJob, 15000);
      } else {
        toast({ title: "Error", description: response.data?.error || "Failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to start prewarm", variant: "destructive" });
    } finally {
      setPublishing(false);
      setPublishingSection(null);
    }
  };

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
        .order("sort_order", { ascending: true });
      setSeeds((data as Seed[]) || []);
    } catch {
      // ignore
    } finally {
      setLoadingSeeds(false);
    }
  };

  // Bump schema version + clear client cache when seeds change
  const invalidateCacheAfterSeedChange = () => {
    clearCatalogHomeCache();
    // Bump web schema version to force clients to refetch
    if (refreshSettings) {
      supabase.from("home_refresh_settings").update({
        web_schema_version: (refreshSettings.web_schema_version || 1) + 1,
        mobile_schema_version: (refreshSettings.mobile_schema_version || 1) + 1,
        updated_at: new Date().toISOString(),
      }).eq("env", "production").then(() => {
        fetchAll();
      });
    }
  };


  const addSeed = async () => {
    if (!newSeedQuery.trim() || !seedModalRecipe) return;
    setAddingSeed(true);
    try {
      const maxSort = seeds.length > 0 ? Math.max(...seeds.map(s => s.sort_order)) : 0;
      const { error } = await supabase.from("home_recipe_seeds").insert({
        recipe_id: seedModalRecipe.id,
        query: newSeedQuery.trim(),
        weight: 1,
        enabled: true,
        sort_order: maxSort + 1,
      });
      if (error) throw error;
      setNewSeedQuery("");
      const { data } = await supabase
        .from("home_recipe_seeds")
        .select("*")
        .eq("recipe_id", seedModalRecipe.id)
        .order("sort_order", { ascending: true });
      setSeeds((data as Seed[]) || []);
      toast({ title: fr ? "Ajouté" : "Added" });
      invalidateCacheAfterSeedChange();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAddingSeed(false);
    }
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const reordered = [...seeds];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    
    // Update local state immediately
    const updated = reordered.map((s, i) => ({ ...s, sort_order: i + 1 }));
    setSeeds(updated);
    setDragIndex(null);
    setDragOverIndex(null);

    // Persist sort_order to DB
    try {
      await Promise.all(
        updated.map(s =>
          supabase.from("home_recipe_seeds").update({ sort_order: s.sort_order }).eq("id", s.id)
        )
      );
      invalidateCacheAfterSeedChange();
    } catch {
      toast({ title: "Error", description: "Failed to save order", variant: "destructive" });
    }
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const deleteSeed = async (seedId: string) => {
    try {
      await supabase.from("home_recipe_seeds").delete().eq("id", seedId);
      setSeeds(prev => prev.filter(s => s.id !== seedId));
      invalidateCacheAfterSeedChange();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const toggleSeedEnabled = async (seed: Seed) => {
    try {
      await supabase.from("home_recipe_seeds").update({ enabled: !seed.enabled }).eq("id", seed.id);
      setSeeds(prev => prev.map(s => s.id === seed.id ? { ...s, enabled: !s.enabled } : s));
      invalidateCacheAfterSeedChange();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const updateSeedField = async (seedId: string, field: string, value: unknown) => {
    try {
      await (supabase.from("home_recipe_seeds") as any).update({ [field]: value }).eq("id", seedId);
      setSeeds(prev => prev.map(s => s.id === seedId ? { ...s, [field]: value } : s));
      invalidateCacheAfterSeedChange();
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

  const rebuild = async (target: "mobile" | "web", recipeKey?: string) => {
    const key = recipeKey || `all_${target}`;
    setRebuildingKey(key);
    try {
      const body: Record<string, unknown> = { target, env: "production" };
      if (recipeKey) body.recipeKey = recipeKey;

      // Fetch current seeds from Test DB and include them so Live DB gets synced
      const recipes = target === "mobile" ? mobileRecipes : webRecipes;
      const targetRecipes = recipeKey ? recipes.filter(r => r.key === recipeKey) : recipes;
      
      if (targetRecipes.length > 0) {
        const recipeIds = targetRecipes.map(r => r.id);
        const { data: currentSeeds } = await supabase
          .from("home_recipe_seeds")
          .select("id, recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms")
          .in("recipe_id", recipeIds)
          .order("sort_order", { ascending: true });
        
        if (currentSeeds && currentSeeds.length > 0) {
          body.seeds = currentSeeds;
        }
      }

      const res = await supabase.functions.invoke("admin-rebuild-home", {
        method: "POST",
        body,
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      const d = res.data;
      const syncMsg = d.seedsSynced ? ` (${d.seedsSynced} seeds synced)` : "";
      toast({
        title: fr ? "✓ Reconstruit!" : "✓ Rebuilt!",
        description: recipeKey 
          ? `${d.itemCount} items for ${recipeKey}, ${d.durationMs}ms${syncMsg}`
          : `${d.itemCount} items, ${d.sectionCount} ${target === "mobile" ? "sections" : "pages"}, ${d.durationMs}ms${syncMsg}`,
      });
      clearCatalogHomeCache();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || String(err), variant: "destructive" });
    } finally {
      setRebuildingKey(null);
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
      {/* Pinned Products Section — FIRST for prominence */}
      <HomepagePinnedItems />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Home className="h-6 w-6" />
            {fr ? "Curation Accueil" : "Home Curation"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {fr
              ? "Gérez les produits affichés sur les pages d'accueil mobile et web."
              : "Manage products shown on mobile and web homepages."}
          </p>
        </div>
        <Button
          onClick={() => handlePublishNow()}
          disabled={publishing}
          size="lg"
          className="gap-2"
        >
          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {fr ? "Publier Tout" : "Publish All"}
        </Button>
      </div>

      {/* Prewarm Status Banner */}
      {lastPrewarmJob && (
        <Card className="bg-muted/50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                {lastPrewarmJob.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : lastPrewarmJob.status === "processing" ? (
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-500" />
                )}
                <span className="font-medium text-sm">
                  {fr ? "Dernière publication" : "Last Publish"}:
                </span>
                <Badge variant={lastPrewarmJob.status === "completed" ? "default" : "secondary"}>
                  {lastPrewarmJob.status}
                </Badge>
                {lastPrewarmJob.completed_at && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(lastPrewarmJob.completed_at), { addSuffix: true })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Sections: {lastPrewarmJob.sections_completed}</span>
                <span>Items: {lastPrewarmJob.mixed_total}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Homepage Curation Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Home className="h-5 w-5" />
            {fr ? "Curation Accueil" : "Home Curation"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="mobile">
            <TabsList>
              <TabsTrigger value="mobile" className="gap-2">
                <Smartphone className="h-4 w-4" />
                {fr ? "App Mobile" : "Mobile App"}
              </TabsTrigger>
              <TabsTrigger value="web" className="gap-2">
                <Globe className="h-4 w-4" />
                {fr ? "App Web" : "Web App"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="mobile">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">
                  {fr ? `${mobileRecipes.length} sections, rafraîchi toutes les ${mobileHours}h` : `${mobileRecipes.length} sections, refreshed every ${mobileHours}h`}
                </p>
                <Button
                  onClick={() => rebuild("mobile")}
                  disabled={rebuildingKey === "all_mobile"}
                  className="gap-2"
                  size="sm"
                >
                  {rebuildingKey === "all_mobile" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {fr ? "Reconstruire Mobile" : "Rebuild Mobile Now"}
                </Button>
              </div>
              <div className="space-y-2">
                {mobileRecipes.map(recipe => (
                  <RecipeRow
                    key={recipe.id}
                    recipe={recipe}
                    fr={fr}
                    onToggle={() => toggleRecipe(recipe)}
                    onEditSeeds={() => openSeedModal(recipe)}
                    onRebuild={() => rebuild("mobile", recipe.key)}
                    rebuilding={rebuildingKey === recipe.key}
                    onPublish={() => handlePublishNow(recipe.key)}
                    publishingThis={publishingSection === recipe.key}
                  />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="web">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">
                  {fr ? `${webRecipes.length} pages × 100 items, rafraîchi toutes les ${webHours}h` : `${webRecipes.length} pages × 100 items, refreshed every ${webHours}h`}
                </p>
                <Button
                  onClick={() => rebuild("web")}
                  disabled={rebuildingKey === "all_web"}
                  className="gap-2"
                  size="sm"
                >
                  {rebuildingKey === "all_web" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {fr ? "Reconstruire Web" : "Rebuild Web Now"}
                </Button>
              </div>
              <div className="space-y-2">
                {webRecipes.map((recipe, i) => (
                  <RecipeRow
                    key={recipe.id}
                    recipe={recipe}
                    fr={fr}
                    highlight={i === 0}
                    onToggle={() => toggleRecipe(recipe)}
                    onEditSeeds={() => openSeedModal(recipe)}
                    onRebuild={() => rebuild("web", recipe.key)}
                    rebuilding={rebuildingKey === recipe.key}
                    onPublish={() => handlePublishNow(recipe.key)}
                    publishingThis={publishingSection === recipe.key}
                  />
                ))}
              </div>
            </TabsContent>
          </Tabs>
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
                {seeds.map((seed, index) => (
                  <div key={seed.id}>
                    <div
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 p-2 rounded cursor-grab active:cursor-grabbing transition-colors ${
                        dragOverIndex === index ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"
                      } ${dragIndex === index ? "opacity-50" : ""}`}
                    >
                      <span className="text-xs text-muted-foreground font-mono w-5 text-center">{index + 1}</span>
                      <Switch
                        checked={seed.enabled}
                        onCheckedChange={() => toggleSeedEnabled(seed)}
                      />
                      <span className={`flex-1 text-sm ${!seed.enabled ? "text-muted-foreground line-through" : ""}`}>
                        {seed.query}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        ×{seed.max_items || 3}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditingSeedId(editingSeedId === seed.id ? null : seed.id)}
                      >
                        <Settings2 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteSeed(seed.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {/* Expandable seed settings */}
                    {editingSeedId === seed.id && (
                      <div className="ml-7 mr-2 p-3 rounded-md bg-muted/30 border border-border space-y-3 mt-1 mb-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{fr ? "Items max (1-5)" : "Max items (1-5)"}</Label>
                          <Input
                            type="number"
                            min={1}
                            max={5}
                            value={seed.max_items || 3}
                            onChange={e => {
                              const v = Math.min(5, Math.max(1, parseInt(e.target.value) || 3));
                              updateSeedField(seed.id, "max_items", v);
                            }}
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{fr ? "Termes requis (virgule)" : "Required terms (comma-sep)"}</Label>
                          <Input
                            placeholder="e.g. tesla, model"
                            defaultValue={(seed.required_terms || []).join(", ")}
                            onBlur={e => {
                              const terms = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
                              updateSeedField(seed.id, "required_terms", terms);
                            }}
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{fr ? "Termes exclus (virgule)" : "Excluded terms (comma-sep)"}</Label>
                          <Input
                            placeholder="e.g. case, cover"
                            defaultValue={(seed.excluded_terms || []).join(", ")}
                            onBlur={e => {
                              const terms = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
                              updateSeedField(seed.id, "excluded_terms", terms);
                            }}
                            className="h-8"
                          />
                        </div>
                      </div>
                    )}
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
  onRebuild,
  rebuilding,
  onPublish,
  publishingThis,
}: {
  recipe: Recipe;
  fr: boolean;
  highlight?: boolean;
  onToggle: () => void;
  onEditSeeds: () => void;
  onRebuild?: () => void;
  rebuilding?: boolean;
  onPublish?: () => void;
  publishingThis?: boolean;
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
      {onPublish && (
        <Button
          variant="default"
          size="sm"
          onClick={onPublish}
          disabled={publishingThis}
          className="gap-1"
        >
          {publishingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {fr ? "Publier" : "Publish"}
        </Button>
      )}
      {onRebuild && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRebuild}
          disabled={rebuilding}
          className="gap-1"
        >
          {rebuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {fr ? "Reconstruire" : "Rebuild"}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onEditSeeds} className="gap-1">
        {fr ? "Requêtes" : "Seeds"}
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
