import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { Database, RefreshCw, Clock, Trash2, Loader2, Search, Home, Settings2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
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
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const CANONICAL_CATEGORIES = [
  { key: 'electronics', label: 'Electronics' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'home_garden', label: 'Home & Garden' },
  { key: 'clothing_shoes_accessories', label: 'Clothing & Shoes' },
  { key: 'toys', label: 'Toys' },
  { key: 'sporting_goods', label: 'Sporting Goods' },
  { key: 'business_industrial', label: 'Business & Industrial' },
  { key: 'jewelry_watches', label: 'Jewelry & Watches' },
  { key: 'refurbished', label: 'Refurbished' },
  { key: 'parts_accessories', label: 'Parts & Accessories' },
];

interface CategoryOverride {
  category_key: string;
  max_item_age_days: number | null;
  price_refresh_days: number | null;
  availability_refresh_days: number | null;
  db_min_results: number | null;
  enabled: boolean;
}

export default function CacheSettings() {
  const { language } = useLanguage();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  
  // Response-level cache TTLs (existing)
  const [searchTtlDays, setSearchTtlDays] = useState(2);
  const [categoriesTtlDays, setCategoriesTtlDays] = useState(1);

  // Global TTL settings (new)
  const [maxItemAgeDays, setMaxItemAgeDays] = useState(30);
  const [priceRefreshDays, setPriceRefreshDays] = useState(3);
  const [availRefreshDays, setAvailRefreshDays] = useState(3);
  const [dbMinResults, setDbMinResults] = useState(5);

  // Per-category overrides
  const [categoryOverrides, setCategoryOverrides] = useState<CategoryOverride[]>(
    CANONICAL_CATEGORIES.map(c => ({
      category_key: c.key,
      max_item_age_days: null,
      price_refresh_days: null,
      availability_refresh_days: null,
      db_min_results: null,
      enabled: true,
    }))
  );

  // ─── Existing response cache settings ───────────────────────────
  const { data: settings, isLoading } = useQuery({
    queryKey: ['catalog-cache-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_cache_settings')
        .select('*')
        .eq('key', 'default')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // ─── Global TTL settings from admin_settings ────────────────────
  const { data: globalTtl, isLoading: globalLoading } = useQuery({
    queryKey: ['admin-ttl-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-catalog-settings', {
        method: 'GET',
      });
      if (error) throw error;
      return data;
    },
  });

  // ─── Category overrides ─────────────────────────────────────────
  const { data: catOverridesData } = useQuery({
    queryKey: ['catalog-category-ttl'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_category_ttl' as any)
        .select('*');
      if (error) throw error;
      return data as any[];
    },
  });

  useEffect(() => {
    if (settings) {
      setSearchTtlDays(Math.round((settings.search_expires_minutes ?? 2880) / 1440));
      setCategoriesTtlDays(Math.round((settings.home_expires_minutes ?? 1440) / 1440));
    }
  }, [settings]);

  useEffect(() => {
    if (globalTtl?.raw) {
      const map = new Map<string, string>();
      for (const r of globalTtl.raw) map.set(r.key, r.value);
      setMaxItemAgeDays(parseInt(map.get('global_max_item_age_days') || '30', 10));
      setPriceRefreshDays(parseInt(map.get('global_price_refresh_days') || '3', 10));
      setAvailRefreshDays(parseInt(map.get('global_availability_refresh_days') || '3', 10));
      setDbMinResults(parseInt(map.get('db_search_min_results') || '5', 10));
    }
  }, [globalTtl]);

  useEffect(() => {
    if (catOverridesData) {
      setCategoryOverrides(prev => prev.map(c => {
        const ov = catOverridesData.find((d: any) => d.category_key === c.category_key);
        if (ov) return { ...c, ...ov };
        return c;
      }));
    }
  }, [catOverridesData]);

  // ─── Mutations ──────────────────────────────────────────────────

  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_clear_search_cache');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const result = data as any;
      toast({
        title: language === 'fr' ? 'Cache vidé' : 'Cache cleared',
        description: language === 'fr'
          ? `Supprimé: catalog=${result.deleted_catalog_cache}, proxy=${result.deleted_search_proxy_cache}`
          : `Cleared: catalog=${result.deleted_catalog_cache}, proxy=${result.deleted_search_proxy_cache}`,
      });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const saveResponseCacheMutation = useMutation({
    mutationFn: async () => {
      const searchExpiresMin = searchTtlDays * 1440;
      const homeExpiresMin = categoriesTtlDays * 1440;
      const { error } = await supabase
        .from('catalog_cache_settings')
        .upsert({
          key: 'default',
          search_expires_minutes: searchExpiresMin,
          search_stale_minutes: Math.floor(searchExpiresMin * 0.5),
          home_expires_minutes: homeExpiresMin,
          home_stale_minutes: Math.floor(homeExpiresMin * 0.5),
          offers_expires_minutes: homeExpiresMin,
          offers_stale_minutes: Math.floor(homeExpiresMin * 0.5),
          negative_expires_seconds: 120,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-cache-settings'] });
      toast({ title: language === 'fr' ? 'Cache réponse sauvegardé' : 'Response cache saved' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const saveGlobalTtlMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-catalog-settings', {
        method: 'POST',
        body: {
          updates: {
            global_max_item_age_days: String(maxItemAgeDays),
            global_price_refresh_days: String(priceRefreshDays),
            global_availability_refresh_days: String(availRefreshDays),
            db_search_min_results: String(dbMinResults),
          },
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-ttl-settings'] });
      toast({ title: language === 'fr' ? 'Paramètres TTL sauvegardés' : 'TTL Settings saved' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const saveCategoryOverridesMutation = useMutation({
    mutationFn: async () => {
      // Only send overrides that have at least one non-null field
      const toSave = categoryOverrides.filter(c => 
        c.max_item_age_days != null || c.price_refresh_days != null || 
        c.availability_refresh_days != null || c.db_min_results != null || !c.enabled
      );
      if (toSave.length === 0) return;
      const { data, error } = await supabase.functions.invoke('admin-catalog-settings', {
        method: 'PUT',
        body: { categoryOverrides: toSave },
      });
      if (error) throw error;
      if (!data?.success) throw new Error('Failed to save overrides');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-category-ttl'] });
      toast({ title: language === 'fr' ? 'Overrides sauvegardés' : 'Category overrides saved' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const applyGlobalToAllMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-catalog-settings', {
        method: 'DELETE',
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-category-ttl'] });
      setCategoryOverrides(CANONICAL_CATEGORIES.map(c => ({
        category_key: c.key,
        max_item_age_days: null,
        price_refresh_days: null,
        availability_refresh_days: null,
        db_min_results: null,
        enabled: true,
      })));
      toast({ title: language === 'fr' ? 'Overrides effacés' : 'All overrides cleared — inheriting global' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const updateOverride = (key: string, field: string, value: any) => {
    setCategoryOverrides(prev => prev.map(c => 
      c.category_key === key ? { ...c, [field]: value } : c
    ));
  };

  if (isLoading || globalLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const priceRefreshWarning = priceRefreshDays > maxItemAgeDays;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Database className="h-6 w-6" />
          {language === 'fr' ? 'Cache & Performance' : 'Cache & Performance'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {language === 'fr'
            ? 'Contrôlez la rétention des données cachées et la fréquence de rafraîchissement.'
            : 'Control cached data retention and refresh frequency.'}
        </p>
      </div>

      {/* ═══ SECTION 1: Global Item Retention & Refresh ═══ */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {language === 'fr' ? 'Rétention & Rafraîchissement (Global)' : 'Item Retention & Refresh (Global)'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? 'Ces paramètres s\'appliquent à toutes les catégories sauf si un override est défini.'
              : 'These settings apply to all categories unless overridden below.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {language === 'fr' ? 'Garder les items en cache (jours)' : 'Keep cached items for (days)'}
              </Label>
              <Input
                type="number" min={7} max={90} value={maxItemAgeDays}
                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setMaxItemAgeDays(v); }}
              />
              <p className="text-xs text-muted-foreground">7–90 {language === 'fr' ? 'jours' : 'days'}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {language === 'fr' ? 'Rafraîchir les prix tous les (jours)' : 'Refresh prices every (days)'}
              </Label>
              <Input
                type="number" min={1} max={14} value={priceRefreshDays}
                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setPriceRefreshDays(v); }}
              />
              {priceRefreshWarning && (
                <p className="text-xs text-destructive">⚠️ {language === 'fr' ? 'Le rafraîchissement ne peut pas dépasser la rétention' : 'Refresh cannot exceed retention'}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {language === 'fr' ? 'Rafraîchir la disponibilité tous les (jours)' : 'Refresh availability every (days)'}
              </Label>
              <Input
                type="number" min={1} max={14} value={availRefreshDays}
                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setAvailRefreshDays(v); }}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {language === 'fr' ? 'Min résultats DB avant API live' : 'Min DB results before live API'}
              </Label>
              <Input
                type="number" min={3} max={50} value={dbMinResults}
                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setDbMinResults(v); }}
              />
              <p className="text-xs text-muted-foreground">3–50</p>
            </div>
          </div>
          <div className="pt-4 border-t">
            <Button
              size="lg"
              onClick={() => saveGlobalTtlMutation.mutate()}
              disabled={saveGlobalTtlMutation.isPending || priceRefreshWarning}
              className="gap-2 w-full md:w-auto"
            >
              {saveGlobalTtlMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {language === 'fr' ? '💾 Sauvegarder les Paramètres Globaux' : '💾 Save Global Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ═══ SECTION 2: Per-Category Overrides ═══ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                {language === 'fr' ? 'Overrides par Catégorie' : 'Per-Category Overrides'}
              </CardTitle>
              <CardDescription className="mt-1">
                {language === 'fr'
                  ? 'Laissez vide pour hériter du global. Les valeurs saisies remplacent le global.'
                  : 'Leave empty to inherit global. Entered values override global.'}
              </CardDescription>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <RefreshCw className="h-3.5 w-3.5" />
                  {language === 'fr' ? 'Appliquer Global à Tout' : 'Apply Global to All'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {language === 'fr' ? 'Effacer tous les overrides ?' : 'Clear all overrides?'}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {language === 'fr'
                      ? 'Toutes les catégories hériteront des paramètres globaux.'
                      : 'All categories will inherit from global settings.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{language === 'fr' ? 'Annuler' : 'Cancel'}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => applyGlobalToAllMutation.mutate()}>
                    {language === 'fr' ? 'Confirmer' : 'Confirm'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'fr' ? 'Catégorie' : 'Category'}</TableHead>
                  <TableHead className="text-center">{language === 'fr' ? 'Âge max (j)' : 'Max Age (d)'}</TableHead>
                  <TableHead className="text-center">{language === 'fr' ? 'Prix (j)' : 'Price (d)'}</TableHead>
                  <TableHead className="text-center">{language === 'fr' ? 'Dispo (j)' : 'Avail (d)'}</TableHead>
                  <TableHead className="text-center">{language === 'fr' ? 'Min DB' : 'Min DB'}</TableHead>
                  <TableHead className="text-center">{language === 'fr' ? 'Actif' : 'Enabled'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CANONICAL_CATEGORIES.map(cat => {
                  const ov = categoryOverrides.find(c => c.category_key === cat.key)!;
                  return (
                    <TableRow key={cat.key}>
                      <TableCell className="font-medium text-sm">{cat.label}</TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number" min={7} max={90}
                          className="w-16 mx-auto text-center h-8"
                          placeholder={String(maxItemAgeDays)}
                          value={ov.max_item_age_days ?? ''}
                          onChange={e => {
                            const v = e.target.value ? parseInt(e.target.value, 10) : null;
                            updateOverride(cat.key, 'max_item_age_days', v);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number" min={1} max={14}
                          className="w-16 mx-auto text-center h-8"
                          placeholder={String(priceRefreshDays)}
                          value={ov.price_refresh_days ?? ''}
                          onChange={e => {
                            const v = e.target.value ? parseInt(e.target.value, 10) : null;
                            updateOverride(cat.key, 'price_refresh_days', v);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number" min={1} max={14}
                          className="w-16 mx-auto text-center h-8"
                          placeholder={String(availRefreshDays)}
                          value={ov.availability_refresh_days ?? ''}
                          onChange={e => {
                            const v = e.target.value ? parseInt(e.target.value, 10) : null;
                            updateOverride(cat.key, 'availability_refresh_days', v);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number" min={3} max={50}
                          className="w-16 mx-auto text-center h-8"
                          placeholder={String(dbMinResults)}
                          value={ov.db_min_results ?? ''}
                          onChange={e => {
                            const v = e.target.value ? parseInt(e.target.value, 10) : null;
                            updateOverride(cat.key, 'db_min_results', v);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={ov.enabled}
                          onCheckedChange={v => updateOverride(cat.key, 'enabled', v)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="pt-4">
            <Button
              size="lg"
              onClick={() => saveCategoryOverridesMutation.mutate()}
              disabled={saveCategoryOverridesMutation.isPending}
              className="gap-2 w-full md:w-auto"
            >
              {saveCategoryOverridesMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {language === 'fr' ? '💾 Sauvegarder les Overrides' : '💾 Save Category Overrides'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ═══ SECTION 3: Response-level cache (existing) ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {language === 'fr' ? 'Cache Réponse API (TTL)' : 'API Response Cache (TTL)'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? 'Contrôle la durée du cache des réponses API (pas la rétention des données).'
              : 'Controls how long API responses are cached (not data retention).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="search_ttl" className="flex items-center gap-2 text-sm font-medium">
                <Search className="h-4 w-4 text-primary" />
                {language === 'fr' ? 'Cache Recherche (jours)' : 'Search Cache (days)'}
              </Label>
              <Input
                id="search_ttl" type="number" min={1} max={30} value={searchTtlDays}
                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setSearchTtlDays(v); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="categories_ttl" className="flex items-center gap-2 text-sm font-medium">
                <Home className="h-4 w-4 text-primary" />
                {language === 'fr' ? 'Cache Catégories / Accueil (jours)' : 'Categories / Home Cache (days)'}
              </Label>
              <Input
                id="categories_ttl" type="number" min={1} max={30} value={categoriesTtlDays}
                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setCategoriesTtlDays(v); }}
              />
            </div>
          </div>
          <div className="pt-4 border-t">
            <Button onClick={() => saveResponseCacheMutation.mutate()} disabled={saveResponseCacheMutation.isPending} className="gap-2">
              {saveResponseCacheMutation.isPending && <RefreshCw className="h-4 w-4 animate-spin" />}
              {language === 'fr' ? 'Enregistrer' : 'Save Changes'}
            </Button>
          </div>
          {settings?.updated_at && (
            <p className="text-xs text-muted-foreground text-center">
              {language === 'fr' ? 'Dernière mise à jour:' : 'Last updated:'} {format(new Date(settings.updated_at), 'PPpp')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ═══ SECTION 4: Clear Cache (existing) ═══ */}
      <Card className="border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-orange-700 dark:text-orange-400">
            <Trash2 className="h-5 w-5" />
            {language === 'fr' ? 'Vider le Cache de Recherche' : 'Clear Search Cache'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/50"
                disabled={clearCacheMutation.isPending}
              >
                {clearCacheMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {language === 'fr' ? 'Vider le Cache' : 'Clear Search Cache'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{language === 'fr' ? 'Vider le cache de recherche ?' : 'Clear search cache?'}</AlertDialogTitle>
                <AlertDialogDescription>
                  {language === 'fr'
                    ? 'Cela supprimera tous les résultats de recherche en cache.'
                    : 'This will remove cached search results.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{language === 'fr' ? 'Annuler' : 'Cancel'}</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearCacheMutation.mutate()} className="bg-orange-600 hover:bg-orange-700 text-white">
                  {language === 'fr' ? 'Vider le Cache' : 'Clear Cache'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
