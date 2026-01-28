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
import { Database, RefreshCw, Zap, Scale, Gauge, Clock, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

interface CacheSettings {
  key: string;
  home_stale_minutes: number | null;
  home_expires_minutes: number | null;
  search_stale_minutes: number | null;
  search_expires_minutes: number | null;
  offers_stale_minutes: number | null;
  offers_expires_minutes: number | null;
  negative_expires_seconds: number | null;
  updated_at: string | null;
}

interface FormData {
  home_stale_minutes: number;
  home_expires_minutes: number;
  search_stale_minutes: number;
  search_expires_minutes: number;
  offers_stale_minutes: number;
  offers_expires_minutes: number;
  negative_expires_seconds: number;
}

const PRESETS = {
  early_stage: {
    label: { en: 'Early Stage (Lowest Cost)', fr: 'Démarrage (Coût Minimum)' },
    icon: Zap,
    description: { 
      en: 'Max caching for first 30-50 users. Reduces API calls by 95%.',
      fr: 'Cache maximum pour les 30-50 premiers utilisateurs. Réduit les appels API de 95%.'
    },
    values: {
      home_stale_minutes: 180,
      home_expires_minutes: 1440,
      search_stale_minutes: 240,
      search_expires_minutes: 2880,
      offers_stale_minutes: 180,
      offers_expires_minutes: 720,
      negative_expires_seconds: 120,
    },
  },
  growth: {
    label: { en: 'Growth (Balanced)', fr: 'Croissance (Équilibré)' },
    icon: Scale,
    description: {
      en: 'Balanced freshness and cost for 100-500 users.',
      fr: 'Équilibre entre fraîcheur et coût pour 100-500 utilisateurs.'
    },
    values: {
      home_stale_minutes: 60,
      home_expires_minutes: 180,
      search_stale_minutes: 30,
      search_expires_minutes: 60,
      offers_stale_minutes: 60,
      offers_expires_minutes: 180,
      negative_expires_seconds: 60,
    },
  },
  scale: {
    label: { en: 'Scale (Fresh Results)', fr: 'À l\'échelle (Résultats Frais)' },
    icon: Gauge,
    description: {
      en: 'Minimal caching for 1000+ users. Real-time prices.',
      fr: 'Cache minimal pour 1000+ utilisateurs. Prix en temps réel.'
    },
    values: {
      home_stale_minutes: 15,
      home_expires_minutes: 60,
      search_stale_minutes: 10,
      search_expires_minutes: 20,
      offers_stale_minutes: 15,
      offers_expires_minutes: 60,
      negative_expires_seconds: 30,
    },
  },
};

export default function CacheSettings() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<FormData>({
    home_stale_minutes: 180,
    home_expires_minutes: 1440,
    search_stale_minutes: 240,
    search_expires_minutes: 2880,
    offers_stale_minutes: 180,
    offers_expires_minutes: 720,
    negative_expires_seconds: 120,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: settings, isLoading } = useQuery({
    queryKey: ['catalog-cache-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_cache_settings')
        .select('*')
        .eq('key', 'default')
        .maybeSingle();
      
      if (error) throw error;
      return data as CacheSettings | null;
    },
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        home_stale_minutes: settings.home_stale_minutes ?? 180,
        home_expires_minutes: settings.home_expires_minutes ?? 1440,
        search_stale_minutes: settings.search_stale_minutes ?? 240,
        search_expires_minutes: settings.search_expires_minutes ?? 2880,
        offers_stale_minutes: settings.offers_stale_minutes ?? 180,
        offers_expires_minutes: settings.offers_expires_minutes ?? 720,
        negative_expires_seconds: settings.negative_expires_seconds ?? 120,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const { error } = await supabase
        .from('catalog_cache_settings')
        .upsert({
          key: 'default',
          ...data,
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

  const validate = (data: FormData): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (data.home_expires_minutes < data.home_stale_minutes) {
      newErrors.home_expires_minutes = language === 'fr' 
        ? 'Expire doit être >= Stale' 
        : 'Expires must be >= Stale';
    }
    if (data.search_expires_minutes < data.search_stale_minutes) {
      newErrors.search_expires_minutes = language === 'fr' 
        ? 'Expire doit être >= Stale' 
        : 'Expires must be >= Stale';
    }
    if (data.offers_expires_minutes < data.offers_stale_minutes) {
      newErrors.offers_expires_minutes = language === 'fr' 
        ? 'Expire doit être >= Stale' 
        : 'Expires must be >= Stale';
    }
    if (data.negative_expires_seconds < 30 || data.negative_expires_seconds > 600) {
      newErrors.negative_expires_seconds = language === 'fr'
        ? 'Doit être entre 30 et 600 secondes'
        : 'Must be between 30 and 600 seconds';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validate(formData)) {
      saveMutation.mutate(formData);
    }
  };

  const applyPreset = (presetKey: keyof typeof PRESETS) => {
    const preset = PRESETS[presetKey];
    setFormData(preset.values);
    setErrors({});
  };

  const handleChange = (field: keyof FormData, value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 0) {
      setFormData(prev => ({ ...prev, [field]: numValue }));
      // Clear error for this field
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)}d`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
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
            ? 'Contrôlez la durée de mise en cache du catalogue pour optimiser les coûts API.'
            : 'Control catalog cache duration to optimize API costs.'}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold text-primary">
                {formatDuration(formData.search_expires_minutes)}
              </div>
              <div className="text-xs text-muted-foreground">
                {language === 'fr' ? 'Cache Recherche' : 'Search Cache'}
              </div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold text-primary">
                {formatDuration(formData.home_expires_minutes)}
              </div>
              <div className="text-xs text-muted-foreground">
                {language === 'fr' ? 'Cache Accueil' : 'Home Cache'}
              </div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold text-primary">
                {formatDuration(formData.offers_expires_minutes)}
              </div>
              <div className="text-xs text-muted-foreground">
                {language === 'fr' ? 'Cache Offres' : 'Offers Cache'}
              </div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold text-primary">
                {formData.negative_expires_seconds}s
              </div>
              <div className="text-xs text-muted-foreground">
                {language === 'fr' ? 'Cache Négatif' : 'Negative Cache'}
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

      {/* Presets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {language === 'fr' ? 'Préréglages Rapides' : 'Quick Presets'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? 'Cliquez pour appliquer des valeurs optimisées selon votre étape de croissance.'
              : 'Click to apply optimized values based on your growth stage.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            {Object.entries(PRESETS).map(([key, preset]) => {
              const Icon = preset.icon;
              return (
                <Button
                  key={key}
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center gap-2 hover:border-primary"
                  onClick={() => applyPreset(key as keyof typeof PRESETS)}
                >
                  <Icon className="h-6 w-6 text-primary" />
                  <span className="font-semibold">
                    {preset.label[language as 'en' | 'fr']}
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    {preset.description[language as 'en' | 'fr']}
                  </span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Manual Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {language === 'fr' ? 'Configuration Manuelle' : 'Manual Configuration'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? 'Stale = durée avant revalidation en arrière-plan. Expires = durée maximale du cache.'
              : 'Stale = time before background revalidation. Expires = maximum cache duration.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Home Cache */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-foreground">
              {language === 'fr' ? 'Cache Page d\'Accueil' : 'Home Page Cache'}
            </h4>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="home_stale" className="text-xs">
                  {language === 'fr' ? 'Stale (minutes)' : 'Stale (minutes)'}
                </Label>
                <Input
                  id="home_stale"
                  type="number"
                  min={1}
                  value={formData.home_stale_minutes}
                  onChange={(e) => handleChange('home_stale_minutes', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="home_expires" className="text-xs">
                  {language === 'fr' ? 'Expire (minutes)' : 'Expires (minutes)'}
                </Label>
                <Input
                  id="home_expires"
                  type="number"
                  min={1}
                  value={formData.home_expires_minutes}
                  onChange={(e) => handleChange('home_expires_minutes', e.target.value)}
                  className="mt-1"
                />
                {errors.home_expires_minutes && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.home_expires_minutes}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Search Cache */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-foreground">
              {language === 'fr' ? 'Cache Recherche' : 'Search Cache'}
            </h4>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="search_stale" className="text-xs">
                  {language === 'fr' ? 'Stale (minutes)' : 'Stale (minutes)'}
                </Label>
                <Input
                  id="search_stale"
                  type="number"
                  min={1}
                  value={formData.search_stale_minutes}
                  onChange={(e) => handleChange('search_stale_minutes', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="search_expires" className="text-xs">
                  {language === 'fr' ? 'Expire (minutes)' : 'Expires (minutes)'}
                </Label>
                <Input
                  id="search_expires"
                  type="number"
                  min={1}
                  value={formData.search_expires_minutes}
                  onChange={(e) => handleChange('search_expires_minutes', e.target.value)}
                  className="mt-1"
                />
                {errors.search_expires_minutes && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.search_expires_minutes}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Offers Cache */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-foreground">
              {language === 'fr' ? 'Cache Offres/Produits' : 'Offers/Products Cache'}
            </h4>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="offers_stale" className="text-xs">
                  {language === 'fr' ? 'Stale (minutes)' : 'Stale (minutes)'}
                </Label>
                <Input
                  id="offers_stale"
                  type="number"
                  min={1}
                  value={formData.offers_stale_minutes}
                  onChange={(e) => handleChange('offers_stale_minutes', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="offers_expires" className="text-xs">
                  {language === 'fr' ? 'Expire (minutes)' : 'Expires (minutes)'}
                </Label>
                <Input
                  id="offers_expires"
                  type="number"
                  min={1}
                  value={formData.offers_expires_minutes}
                  onChange={(e) => handleChange('offers_expires_minutes', e.target.value)}
                  className="mt-1"
                />
                {errors.offers_expires_minutes && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.offers_expires_minutes}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Negative Cache */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-foreground">
              {language === 'fr' ? 'Cache Négatif (erreurs/vide)' : 'Negative Cache (errors/empty)'}
            </h4>
            <div className="max-w-xs">
              <Label htmlFor="negative_expires" className="text-xs">
                {language === 'fr' ? 'Durée (secondes, 30-600)' : 'Duration (seconds, 30-600)'}
              </Label>
              <Input
                id="negative_expires"
                type="number"
                min={30}
                max={600}
                value={formData.negative_expires_seconds}
                onChange={(e) => handleChange('negative_expires_seconds', e.target.value)}
                className="mt-1"
              />
              {errors.negative_expires_seconds && (
                <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.negative_expires_seconds}
                </p>
              )}
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t">
            <Button 
              onClick={handleSave} 
              disabled={saveMutation.isPending}
              className="gap-2"
            >
              {saveMutation.isPending && <RefreshCw className="h-4 w-4 animate-spin" />}
              {language === 'fr' ? 'Enregistrer' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
