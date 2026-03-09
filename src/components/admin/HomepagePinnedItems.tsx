import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { Pin, Search, Trash2, Loader2, Image, GripVertical } from "lucide-react";

const ALL_CATEGORIES = [
  'phones', 'electronics', 'audio_music', 'gaming',
  'vehicles', 'home_garden', 'toys', 'sporting_goods',
  'jewelry_watches', 'parts_accessories', 'refurbished',
  'clothing', 'cameras_photo',
];

const CAT_LABELS: Record<string, string> = {
  phones: 'Phones', electronics: 'Electronics', audio_music: 'Audio & Music',
  gaming: 'Gaming', vehicles: 'Vehicles', home_garden: 'Home & Garden',
  toys: 'Toys', sporting_goods: 'Sports', jewelry_watches: 'Jewelry & Watches',
  parts_accessories: 'Auto Parts', refurbished: 'Refurbished',
  clothing: 'Fashion', cameras_photo: 'Cameras & Photo',
};

interface PinnedItem {
  id: string;
  category_key: string;
  catalog_item_id: string;
  provider: string;
  provider_product_id: string;
  title: string | null;
  image_url: string | null;
  price_usd: number | null;
  sort_order: number;
}

interface SearchResult {
  id: string;
  provider: string;
  provider_product_id: string | null;
  title: string | null;
  image_url: string | null;
  price_usd: number | null;
}

export function HomepagePinnedItems() {
  const { language } = useLanguage();
  const fr = language === "fr";

  const [pinnedByCategory, setPinnedByCategory] = useState<Record<string, PinnedItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchCategory, setSearchCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchPins = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("homepage_pinned_items")
        .select("*")
        .order("category_key")
        .order("sort_order");
      if (error) throw error;
      const grouped: Record<string, PinnedItem[]> = {};
      for (const item of (data || []) as PinnedItem[]) {
        if (!grouped[item.category_key]) grouped[item.category_key] = [];
        grouped[item.category_key].push(item);
      }
      setPinnedByCategory(grouped);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPins(); }, [fetchPins]);

  const searchItems = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const { data, error } = await supabase
        .from("catalog_items")
        .select("id, provider, provider_product_id, title, image_url, price_usd")
        .eq("is_active", true)
        .eq("is_disallowed", false)
        .gt("price_usd", 0)
        .not("image_url", "is", null)
        .ilike("title", `%${searchQuery.trim()}%`)
        .order("price_usd", { ascending: false })
        .limit(40);
      if (error) throw error;
      // Filter to items with valid images
      setSearchResults((data || []).filter(d => d.image_url && d.image_url.startsWith("http")));
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const pinItem = async (item: SearchResult) => {
    if (!searchCategory) return;
    const currentPins = pinnedByCategory[searchCategory] || [];
    if (currentPins.length >= 4) {
      toast({ title: fr ? "Maximum 4 produits" : "Maximum 4 products", variant: "destructive" });
      return;
    }
    if (currentPins.some(p => p.catalog_item_id === item.id)) {
      toast({ title: fr ? "Déjà épinglé" : "Already pinned", variant: "destructive" });
      return;
    }
    setPinning(item.id);
    try {
      const { error } = await supabase.from("homepage_pinned_items").insert({
        category_key: searchCategory,
        catalog_item_id: item.id,
        provider: item.provider || "ebay",
        provider_product_id: item.provider_product_id || item.id,
        title: item.title,
        image_url: item.image_url,
        price_usd: item.price_usd,
        sort_order: currentPins.length,
      });
      if (error) throw error;
      toast({ title: fr ? "Épinglé !" : "Pinned!" });
      fetchPins();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setPinning(null);
    }
  };

  const removePin = async (pinId: string) => {
    setRemoving(pinId);
    try {
      const { error } = await supabase.from("homepage_pinned_items").delete().eq("id", pinId);
      if (error) throw error;
      fetchPins();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  const clearCategory = async (catKey: string) => {
    try {
      const { error } = await supabase.from("homepage_pinned_items").delete().eq("category_key", catKey);
      if (error) throw error;
      fetchPins();
      toast({ title: fr ? "Vidé" : "Cleared" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  if (loading) return <div className="py-4 text-center text-muted-foreground">Loading pins...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Pin className="h-5 w-5" />
          {fr ? "Produits Épinglés par Catégorie (4 max)" : "Pinned Products per Category (4 max)"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {fr
            ? "Choisissez exactement 4 produits avec de belles images pour chaque catégorie. Ces produits remplaceront le contenu automatique."
            : "Pick exactly 4 products with great images for each category. These replace the automatic content."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {ALL_CATEGORIES.map(catKey => {
          const pins = pinnedByCategory[catKey] || [];
          return (
            <div key={catKey} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{CAT_LABELS[catKey] || catKey}</span>
                  <Badge variant={pins.length === 4 ? "default" : "secondary"} className="text-xs">
                    {pins.length}/4
                  </Badge>
                </div>
                <div className="flex gap-1">
                  {pins.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => clearCategory(catKey)} className="text-xs text-destructive">
                      {fr ? "Vider" : "Clear"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setSearchCategory(catKey); setSearchQuery(""); setSearchResults([]); }}
                    className="text-xs gap-1"
                  >
                    <Search className="h-3 w-3" />
                    {pins.length < 4 ? (fr ? "Ajouter" : "Add") : (fr ? "Remplacer" : "Replace")}
                  </Button>
                </div>
              </div>

              {pins.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {pins.map((pin) => (
                    <div key={pin.id} className="relative group border rounded-md overflow-hidden bg-white">
                      <div className="aspect-square p-1">
                        {pin.image_url ? (
                          <img src={pin.image_url} alt={pin.title || ""} className="w-full h-full object-contain" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted">
                            <Image className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="p-1.5">
                        <p className="text-[10px] line-clamp-2 text-foreground/70">{pin.title}</p>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] font-medium">${pin.price_usd?.toFixed(2)}</span>
                          <Badge variant="outline" className="text-[8px] px-1 py-0">{pin.provider}</Badge>
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removePin(pin.id)}
                        disabled={removing === pin.id}
                      >
                        {removing === pin.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      {/* Search Dialog */}
      <Dialog open={!!searchCategory} onOpenChange={(open) => { if (!open) setSearchCategory(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              {fr ? "Ajouter un produit à" : "Add product to"} {CAT_LABELS[searchCategory || ""] || searchCategory}
            </DialogTitle>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              placeholder={fr ? "Rechercher un produit (ex: iPhone, Samsung TV)..." : "Search product (e.g. iPhone, Samsung TV)..."}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchItems()}
            />
            <Button onClick={searchItems} disabled={searching || !searchQuery.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          <ScrollArea className="max-h-[50vh]">
            {searchResults.length === 0 && !searching && (
              <p className="text-sm text-muted-foreground text-center py-8">
                {fr ? "Tapez une recherche pour trouver des produits (Amazon, eBay, etc.)" : "Type a search to find products (Amazon, eBay, etc.)"}
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {searchResults.map(item => {
                const alreadyPinned = (pinnedByCategory[searchCategory || ""] || []).some(p => p.catalog_item_id === item.id);
                return (
                  <div
                    key={item.id}
                    className={`border rounded-lg overflow-hidden bg-white cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 ${alreadyPinned ? "opacity-50" : ""}`}
                    onClick={() => !alreadyPinned && pinItem(item)}
                  >
                    <div className="aspect-square p-2 bg-white">
                      <img
                        src={item.image_url || "/placeholder.svg"}
                        alt={item.title || ""}
                        className="w-full h-full object-contain"
                        onError={e => { (e.target as HTMLImageElement).src = "/placeholder.svg"; }}
                      />
                    </div>
                    <div className="p-2 bg-background">
                      <p className="text-xs line-clamp-2 text-foreground/80">{item.title}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs font-bold">${item.price_usd?.toFixed(2)}</span>
                        <Badge variant="outline" className="text-[9px]">
                          {item.provider === "rainforest" ? "Amazon" : item.provider}
                        </Badge>
                      </div>
                      {pinning === item.id && <Loader2 className="h-3 w-3 animate-spin mt-1" />}
                      {alreadyPinned && <span className="text-[9px] text-green-600">✓ Pinned</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
