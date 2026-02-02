import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { useAuthenticatedApi } from "@/hooks/useAuthenticatedApi";
import { 
  Home, RefreshCw, Plus, Trash2, Sparkles, CheckCircle2, 
  Loader2, Clock, AlertCircle, GripVertical
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface HomeSection {
  key: string;
  title_en: string;
  title_fr: string;
  enabled: boolean;
  sort_order: number;
  default_category_key: string | null;
  ebay_category: string | null;
  is_vehicle: boolean;
  min_price: number;
  see_all_query: string | null;
  seed_count: number;
  suggestion_count: number;
}

interface SeedQuery {
  id: string;
  section_key: string;
  query: string;
  enabled: boolean;
  weight: number;
}

interface Suggestion {
  id: string;
  section_key: string;
  query: string;
  source: string;
  score: number;
  approved: boolean;
}

interface PrewarmJob {
  id: string;
  status: string;
  rotation_key: string;
  started_at: string | null;
  completed_at: string | null;
  sections_completed: number;
  amazon_fetched: number;
  ebay_fetched: number;
  mixed_total: number;
}

export default function HomeCuration() {
  const { language } = useLanguage();
  const { post, get, delete: apiDelete } = useAuthenticatedApi();

  // State
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [seeds, setSeeds] = useState<SeedQuery[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [seedMode, setSeedMode] = useState<string>("manual");
  const [newSeedQuery, setNewSeedQuery] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [selectedSeeds, setSelectedSeeds] = useState<Set<string>>(new Set());
  const [lastPrewarmJob, setLastPrewarmJob] = useState<PrewarmJob | null>(null);
  
  // Loading states
  const [loadingSections, setLoadingSections] = useState(true);
  const [loadingSeeds, setLoadingSeeds] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [approvingSuggestions, setApprovingSuggestions] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [addingSeed, setAddingSeed] = useState(false);
  const [deletingSeeds, setDeletingSeeds] = useState(false);

  // Fetch sections on mount
  useEffect(() => {
    fetchSections();
    fetchLastPrewarmJob();
  }, []);

  // Fetch seeds when section changes - also clear seed selection
  useEffect(() => {
    if (selectedSection) {
      setSelectedSeeds(new Set());
      fetchSeeds(selectedSection);
      fetchSuggestions(selectedSection);
    }
  }, [selectedSection]);

  const fetchSections = async () => {
    setLoadingSections(true);
    try {
      const response = await get("admin-home-sections");
      if (response.data?.ok) {
        setSections(response.data.sections);
        setSeedMode(response.data.seed_mode || "manual");
        if (response.data.sections.length > 0 && !selectedSection) {
          setSelectedSection(response.data.sections[0].key);
        }
      }
    } catch (error) {
      console.error("Failed to fetch sections:", error);
      toast({ title: "Error", description: "Failed to load sections", variant: "destructive" });
    } finally {
      setLoadingSections(false);
    }
  };

  const fetchSeeds = async (sectionKey: string) => {
    setLoadingSeeds(true);
    try {
      const response = await get(`admin-home-seeds?section_key=${sectionKey}`);
      if (response.data?.ok) {
        setSeeds(response.data.seeds);
      }
    } catch (error) {
      console.error("Failed to fetch seeds:", error);
    } finally {
      setLoadingSeeds(false);
    }
  };

  const fetchSuggestions = async (sectionKey: string) => {
    setLoadingSuggestions(true);
    try {
      const response = await get(`admin-home-seed-suggestions?section_key=${sectionKey}`);
      if (response.data?.ok) {
        setSuggestions(response.data.suggestions.filter((s: Suggestion) => !s.approved));
        setSelectedSuggestions(new Set());
      }
    } catch (error) {
      console.error("Failed to fetch suggestions:", error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const fetchLastPrewarmJob = async () => {
    try {
      const response = await get("catalog-prewarm-home?action=status");
      if (response.data?.lastJob) {
        setLastPrewarmJob(response.data.lastJob);
      }
    } catch (error) {
      console.error("Failed to fetch prewarm status:", error);
    }
  };

  const handleAddSeed = async () => {
    if (!newSeedQuery.trim() || !selectedSection) return;
    
    setAddingSeed(true);
    try {
      const response = await post("admin-home-seeds", {
        section_key: selectedSection,
        query: newSeedQuery.trim(),
        enabled: true,
        weight: 100,
      });
      
      if (response.data?.ok) {
        toast({ title: "Success", description: "Seed query added" });
        setNewSeedQuery("");
        fetchSeeds(selectedSection);
        fetchSections(); // Refresh counts
      } else {
        toast({ title: "Error", description: response.data?.error || "Failed to add seed", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to add seed", variant: "destructive" });
    } finally {
      setAddingSeed(false);
    }
  };

  const handleToggleSeed = async (seed: SeedQuery) => {
    try {
      await post("admin-home-seeds", {
        id: seed.id,
        section_key: seed.section_key,
        query: seed.query,
        enabled: !seed.enabled,
      });
      fetchSeeds(selectedSection);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update seed", variant: "destructive" });
    }
  };

  const handleDeleteSeed = async (seedId: string) => {
    try {
      const response = await apiDelete("admin-home-seeds", { id: seedId });
      console.log("[HomeCuration] Single delete response:", response);
      
      if (response.data?.ok) {
        toast({ title: "Deleted", description: "Seed removed" });
        fetchSeeds(selectedSection);
        fetchSections(); // Refresh counts
      } else {
        const errorMessage = response.data?.error || response.data?.message || response.error || "Failed to delete seed";
        toast({ title: "Error", description: errorMessage, variant: "destructive" });
      }
    } catch (error: any) {
      console.error("[HomeCuration] Delete seed exception:", error);
      toast({ title: "Error", description: error.message || "Failed to delete seed", variant: "destructive" });
    }
  };

  const handleGenerateSuggestions = async () => {
    if (!selectedSection) return;
    
    setGeneratingSuggestions(true);
    try {
      const response = await post("admin-home-seed-suggestions", {
        action: "generate",
        section_key: selectedSection,
      });
      
      if (response.data?.ok) {
        toast({ 
          title: "Generated", 
          description: `${response.data.count} suggestions created` 
        });
        fetchSuggestions(selectedSection);
        fetchSections(); // Refresh counts
      } else {
        toast({ title: "Error", description: response.data?.error || "Failed to generate", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to generate suggestions", variant: "destructive" });
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const handleApproveSuggestions = async () => {
    if (selectedSuggestions.size === 0) return;
    
    setApprovingSuggestions(true);
    try {
      const response = await post("admin-home-seed-suggestions", {
        action: "approve",
        suggestion_ids: Array.from(selectedSuggestions),
      });
      
      if (response.data?.ok) {
        toast({ 
          title: "Approved", 
          description: `${response.data.count} suggestions added as seeds` 
        });
        setSelectedSuggestions(new Set());
        fetchSeeds(selectedSection);
        fetchSuggestions(selectedSection);
        fetchSections(); // Refresh counts
      } else {
        toast({ title: "Error", description: response.data?.error || "Failed to approve", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve suggestions", variant: "destructive" });
    } finally {
      setApprovingSuggestions(false);
    }
  };

  const handlePublishNow = async () => {
    setPublishing(true);
    try {
      const response = await post("catalog-prewarm-home", {});
      
      if (response.data?.ok) {
        toast({ 
          title: "Publishing", 
          description: `Started prewarm job: ${response.data.jobId}` 
        });
        // Poll for updates
        setTimeout(fetchLastPrewarmJob, 2000);
        setTimeout(fetchLastPrewarmJob, 5000);
        setTimeout(fetchLastPrewarmJob, 10000);
      } else {
        toast({ title: "Error", description: response.data?.error || "Failed to start prewarm", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to start prewarm", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const toggleSuggestion = (id: string) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllSuggestions = () => {
    if (selectedSuggestions.size === suggestions.length) {
      setSelectedSuggestions(new Set());
    } else {
      setSelectedSuggestions(new Set(suggestions.map(s => s.id)));
    }
  };

  // Seed selection handlers
  const toggleSeedSelection = (seedId: string) => {
    setSelectedSeeds(prev => {
      const next = new Set(prev);
      if (next.has(seedId)) {
        next.delete(seedId);
      } else {
        next.add(seedId);
      }
      return next;
    });
  };

  const selectAllSeeds = () => {
    if (selectedSeeds.size === seeds.length) {
      setSelectedSeeds(new Set());
    } else {
      setSelectedSeeds(new Set(seeds.map(s => s.id)));
    }
  };

  const handleBulkDeleteSeeds = async () => {
    if (selectedSeeds.size === 0) return;
    
    setDeletingSeeds(true);
    try {
      const response = await apiDelete("admin-home-seeds", { 
        ids: Array.from(selectedSeeds) 
      });
      
      console.log("[HomeCuration] Delete response:", response);
      
      if (response.data?.ok) {
        toast({ 
          title: "Deleted", 
          description: `${response.data.count || selectedSeeds.size} seeds removed` 
        });
        setSelectedSeeds(new Set());
        fetchSeeds(selectedSection);
        fetchSections(); // Refresh counts
      } else {
        // Handle error response - check both 'error' and 'message' fields
        const errorMessage = response.data?.error || response.data?.message || response.error || "Failed to delete seeds";
        console.error("[HomeCuration] Delete failed:", errorMessage);
        toast({ title: "Error", description: errorMessage, variant: "destructive" });
      }
    } catch (error: any) {
      console.error("[HomeCuration] Delete exception:", error);
      toast({ title: "Error", description: error.message || "Failed to delete seeds", variant: "destructive" });
    } finally {
      setDeletingSeeds(false);
    }
  };

  const currentSection = sections.find(s => s.key === selectedSection);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Home className="h-8 w-8" />
            {language === "fr" ? "Curation Accueil" : "Home Curation"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {language === "fr" 
              ? "Gérez les requêtes de recherche pour chaque section de la page d'accueil"
              : "Manage search queries for each homepage section"}
          </p>
        </div>
        <Button 
          onClick={handlePublishNow} 
          disabled={publishing}
          size="lg"
        >
          {publishing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {language === "fr" ? "Publier Maintenant" : "Publish Now"}
        </Button>
      </div>

      {/* Status Banner */}
      {lastPrewarmJob && (
        <Card className="bg-muted/50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  {lastPrewarmJob.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : lastPrewarmJob.status === "processing" ? (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                  )}
                  <span className="font-medium">
                    {language === "fr" ? "Dernière publication" : "Last Publish"}:
                  </span>
                  <Badge variant={lastPrewarmJob.status === "completed" ? "default" : "secondary"}>
                    {lastPrewarmJob.status}
                  </Badge>
                </div>
                {lastPrewarmJob.completed_at && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {formatDistanceToNow(new Date(lastPrewarmJob.completed_at), { addSuffix: true })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span>Rotation: <code className="bg-muted px-1 rounded">{lastPrewarmJob.rotation_key}</code></span>
                <span>Sections: {lastPrewarmJob.sections_completed}/8</span>
                <span>Items: {lastPrewarmJob.mixed_total}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-xs">
          <Label className="mb-2 block">
            {language === "fr" ? "Section" : "Section"}
          </Label>
          <Select value={selectedSection} onValueChange={setSelectedSection}>
            <SelectTrigger>
              <SelectValue placeholder="Select section" />
            </SelectTrigger>
            <SelectContent>
              {sections.map(section => (
                <SelectItem key={section.key} value={section.key}>
                  <div className="flex items-center justify-between gap-4">
                    <span>{language === "fr" ? section.title_fr : section.title_en}</span>
                    <Badge variant="outline" className="ml-2">
                      {section.seed_count} seeds
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-2 block">
            {language === "fr" ? "Mode" : "Mode"}
          </Label>
          <Badge variant="secondary" className="px-3 py-2">
            {seedMode}
          </Badge>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Seeds */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{language === "fr" ? "Requêtes Actives" : "Active Seeds"}</span>
              <Badge>{seeds.filter(s => s.enabled).length}</Badge>
            </CardTitle>
            <CardDescription>
              {language === "fr" 
                ? "Les requêtes utilisées pour remplir cette section"
                : "Queries used to populate this section"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add new seed */}
            <div className="flex gap-2">
              <Input
                placeholder={language === "fr" ? "Nouvelle requête..." : "New query..."}
                value={newSeedQuery}
                onChange={(e) => setNewSeedQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddSeed()}
              />
              <Button 
                onClick={handleAddSeed} 
                disabled={!newSeedQuery.trim() || addingSeed || !selectedSection}
                size="icon"
              >
                {addingSeed ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>

            <Separator />

            {/* Bulk action toolbar for seeds */}
            {seeds.length > 0 && (
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectAllSeeds}
                  disabled={loadingSeeds}
                >
                  {selectedSeeds.size === seeds.length 
                    ? (language === "fr" ? "Désélectionner tout" : "Deselect All")
                    : (language === "fr" ? "Tout sélectionner" : "Select All")}
                </Button>
                
                {selectedSeeds.size > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deletingSeeds}
                      >
                        {deletingSeeds ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        {language === "fr" ? "Supprimer" : "Delete"} ({selectedSeeds.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {language === "fr" 
                            ? `Supprimer ${selectedSeeds.size} requêtes ?`
                            : `Delete ${selectedSeeds.size} seeds?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {language === "fr"
                            ? "Cette action est irréversible. Les requêtes sélectionnées seront définitivement supprimées."
                            : "This action cannot be undone. The selected queries will be permanently removed."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {language === "fr" ? "Annuler" : "Cancel"}
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={handleBulkDeleteSeeds}>
                          {language === "fr" ? "Supprimer" : "Delete"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            )}

            {/* Seeds list */}
            <ScrollArea className="h-[300px]">
              {loadingSeeds ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : seeds.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {language === "fr" 
                    ? "Aucune requête. Ajoutez-en ou générez des suggestions."
                    : "No seeds yet. Add one or generate suggestions."}
                </div>
              ) : (
                <div className="space-y-2">
                  {seeds.map(seed => (
                    <div 
                      key={seed.id} 
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedSeeds.has(seed.id) 
                          ? "bg-primary/10 border-primary" 
                          : seed.enabled ? "bg-background hover:bg-muted/50" : "bg-muted/50 opacity-60"
                      }`}
                      onClick={() => toggleSeedSelection(seed.id)}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Checkbox
                          checked={selectedSeeds.has(seed.id)}
                          onCheckedChange={() => toggleSeedSelection(seed.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{seed.query}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={seed.enabled}
                          onCheckedChange={() => handleToggleSeed(seed)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteSeed(seed.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Suggestions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{language === "fr" ? "Suggestions" : "Suggestions"}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateSuggestions}
                disabled={generatingSuggestions || !selectedSection}
              >
                {generatingSuggestions ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {language === "fr" ? "Générer" : "Generate"}
              </Button>
            </CardTitle>
            <CardDescription>
              {language === "fr" 
                ? "Sélectionnez des suggestions à approuver comme requêtes actives"
                : "Select suggestions to approve as active seeds"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Actions */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllSuggestions}
                disabled={suggestions.length === 0}
              >
                {selectedSuggestions.size === suggestions.length 
                  ? (language === "fr" ? "Désélectionner tout" : "Deselect All")
                  : (language === "fr" ? "Tout sélectionner" : "Select All")}
              </Button>
              <Button
                onClick={handleApproveSuggestions}
                disabled={selectedSuggestions.size === 0 || approvingSuggestions}
                size="sm"
              >
                {approvingSuggestions ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                {language === "fr" ? "Approuver" : "Approve"} ({selectedSuggestions.size})
              </Button>
            </div>

            <Separator />

            {/* Suggestions list */}
            <ScrollArea className="h-[300px]">
              {loadingSuggestions ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : suggestions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {language === "fr" 
                    ? "Aucune suggestion. Cliquez sur Générer pour en créer."
                    : "No suggestions. Click Generate to create some."}
                </div>
              ) : (
                <div className="space-y-2">
                  {suggestions.map(suggestion => (
                    <div 
                      key={suggestion.id} 
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedSuggestions.has(suggestion.id) 
                          ? "bg-primary/10 border-primary" 
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => toggleSuggestion(suggestion.id)}
                    >
                      <Checkbox
                        checked={selectedSuggestions.has(suggestion.id)}
                        onCheckedChange={() => toggleSuggestion(suggestion.id)}
                      />
                      <span className="flex-1 truncate">{suggestion.query}</span>
                      <Badge variant="outline" className="shrink-0">
                        {suggestion.source}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Section Settings */}
      {currentSection && (
        <Card>
          <CardHeader>
            <CardTitle>
              {language === "fr" ? "Paramètres de Section" : "Section Settings"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">
                  {language === "fr" ? "Catégorie par défaut" : "Default Category"}
                </Label>
                <p className="font-medium">{currentSection.default_category_key || "-"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">
                  {language === "fr" ? "Catégorie eBay" : "eBay Category"}
                </Label>
                <p className="font-medium">{currentSection.ebay_category || "-"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">
                  {language === "fr" ? "Prix minimum" : "Min Price"}
                </Label>
                <p className="font-medium">${currentSection.min_price}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">
                  {language === "fr" ? "Véhicule" : "Vehicle"}
                </Label>
                <p className="font-medium">{currentSection.is_vehicle ? "Yes" : "No"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
