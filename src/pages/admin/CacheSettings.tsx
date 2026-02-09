import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { Database, RefreshCw, Clock, Trash2, Loader2, Search, Home } from 'lucide-react';
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

export default function CacheSettings() {
  const { language } = useLanguage();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [searchTtlDays, setSearchTtlDays] = useState(2);
  const [categoriesTtlDays, setCategoriesTtlDays] = useState(1);

  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_clear_search_cache');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const result = data as { 
        ok: boolean; 
        deleted_catalog_cache: number; 
        deleted_search_proxy_cache: number;
        cleared_at: string;
      };
      console.log(JSON.stringify({ event: "[ADMIN_CACHE] clear_cache", userId: session?.user?.id, result }));
      toast({
        title: language === 'fr' ? 'Cache vidé' : 'Cache cleared',
        description: language === 'fr'
          ? `Supprimé: catalog=${result.deleted_catalog_cache}, proxy=${result.deleted_search_proxy_cache}`
          : `Cleared: catalog=${result.deleted_catalog_cache}, proxy=${result.deleted_search_proxy_cache}`,
      });
    },
    onError: (error) => {
      console.warn(JSON.stringify({ event: "[ADMIN_CACHE] clear_cache_error", userId: session?.user?.id, error: error instanceof Error ? error.message : 'Unknown error' }));
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

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

  useEffect(() => {
    if (settings) {
      setSearchTtlDays(Math.round((settings.search_expires_minutes ?? 2880) / 1440));
      setCategoriesTtlDays(Math.round((settings.home_expires_minutes ?? 1440) / 1440));
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const searchExpiresMin = searchTtlDays * 1440;
      const searchStaleMin = Math.floor(searchExpiresMin * 0.5);
      const homeExpiresMin = categoriesTtlDays * 1440;
      const homeStaleMin = Math.floor(homeExpiresMin * 0.5);

      const { error } = await supabase
        .from('catalog_cache_settings')
        .upsert({
          key: 'default',
          search_expires_minutes: searchExpiresMin,
          search_stale_minutes: searchStaleMin,
          home_expires_minutes: homeExpiresMin,
          home_stale_minutes: homeStaleMin,
          offers_expires_minutes: homeExpiresMin,
          offers_stale_minutes: homeStaleMin,
          negative_expires_seconds: 120,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-cache-settings'] });
      toast({
        title: language === 'fr' ? 'Paramètres sauvegardés' : 'Settings saved',
        description: language === 'fr' 
          ? 'Les nouveaux TTL sont actifs immédiatement.'
          : 'New TTLs are active immediately.',
      });
    },
    onError: (error) => {
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

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
            ? 'Définissez la durée de cache en jours. Les recherches similaires partagent automatiquement le même cache.'
            : 'Set cache duration in days. Similar searches automatically share the same cache.'}
        </p>
      </div>

      {/* Current Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {language === 'fr' ? 'État Actuel' : 'Current Status'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-3xl font-bold text-primary">
                {searchTtlDays}d
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {language === 'fr' ? 'Cache Recherche' : 'Search Cache'}
              </div>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-3xl font-bold text-primary">
                {categoriesTtlDays}d
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {language === 'fr' ? 'Cache Catégories / Accueil' : 'Categories / Home Cache'}
              </div>
            </div>
          </div>
          {settings?.updated_at && (
            <p className="text-xs text-muted-foreground mt-4 text-center">
              {language === 'fr' ? 'Dernière mise à jour:' : 'Last updated:'}{' '}
              {format(new Date(settings.updated_at), 'PPpp')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* TTL Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {language === 'fr' ? 'Durée du Cache (TTL)' : 'Cache Duration (TTL)'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? 'Tous les utilisateurs qui recherchent le même terme dans cette fenêtre verront les résultats en cache instantanément.'
              : 'All users searching the same term within this window will see cached results instantly.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Search TTL */}
            <div className="space-y-2">
              <Label htmlFor="search_ttl" className="flex items-center gap-2 text-sm font-medium">
                <Search className="h-4 w-4 text-primary" />
                {language === 'fr' ? 'Cache Recherche (jours)' : 'Search Cache TTL (days)'}
              </Label>
              <Input
                id="search_ttl"
                type="number"
                min={1}
                max={30}
                value={searchTtlDays}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1) setSearchTtlDays(v);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {language === 'fr'
                  ? 'Résultats de recherche et produits similaires'
                  : 'Search results and similar product queries'}
              </p>
            </div>

            {/* Categories/Home TTL */}
            <div className="space-y-2">
              <Label htmlFor="categories_ttl" className="flex items-center gap-2 text-sm font-medium">
                <Home className="h-4 w-4 text-primary" />
                {language === 'fr' ? 'Cache Catégories / Accueil (jours)' : 'Categories / Home TTL (days)'}
              </Label>
              <Input
                id="categories_ttl"
                type="number"
                min={1}
                max={30}
                value={categoriesTtlDays}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1) setCategoriesTtlDays(v);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {language === 'fr'
                  ? 'Accueil, Jeux Vidéo, Véhicules, Salon, etc.'
                  : 'Home, Gaming, Vehicles, Living Room, etc.'}
              </p>
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t">
            <Button 
              onClick={() => saveMutation.mutate()} 
              disabled={saveMutation.isPending}
              className="gap-2"
            >
              {saveMutation.isPending && <RefreshCw className="h-4 w-4 animate-spin" />}
              {language === 'fr' ? 'Enregistrer' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Clear Search Cache */}
      <Card className="border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-orange-700 dark:text-orange-400">
            <Trash2 className="h-5 w-5" />
            {language === 'fr' ? 'Vider le Cache de Recherche' : 'Clear Search Cache'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? 'Supprimez immédiatement tous les résultats de recherche en cache.'
              : 'Immediately remove all cached search results.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="outline" 
                className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/50"
                disabled={clearCacheMutation.isPending}
              >
                {clearCacheMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {language === 'fr' ? 'Vider le Cache' : 'Clear Search Cache'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {language === 'fr' ? 'Vider le cache de recherche ?' : 'Clear search cache?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {language === 'fr'
                    ? 'Cela supprimera tous les résultats de recherche en cache. Les nouvelles recherches peuvent être plus lentes pendant quelques minutes.'
                    : 'This will remove cached search results. New searches may be slower for a few minutes.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {language === 'fr' ? 'Annuler' : 'Cancel'}
                </AlertDialogCancel>
                <AlertDialogAction 
                  onClick={() => clearCacheMutation.mutate()}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
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
