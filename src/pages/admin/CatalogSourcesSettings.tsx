import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { 
  Store, 
  Settings2, 
  DollarSign, 
  Shuffle, 
  Clock, 
  Save, 
  RefreshCw,
  AlertCircle,
  Zap,
  Shield,
  Flame,
  Home,
  Search,
  Layers,
  CheckCircle2,
  XCircle,
  Trash2,
  Loader2,
  ShieldCheck
} from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';

interface PrewarmJob {
  id: string;
  status: string;
  rotation_key: string | null;
  sections_total: number;
  sections_completed: number;
  current_section: string | null;
  amazon_fetched: number;
  ebay_fetched: number;
  mixed_total: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  last_heartbeat: string | null;
}

interface CatalogSettings {
  catalog_provider_mode: string;
  amazon_enabled: boolean;
  ebay_enabled: boolean;
  amazon_max_results_per_query: number;
  amazon_max_calls_per_hour: number;
  amazon_budget_window: string;
  mixed_amazon_first_count: number;
  mixed_blend_ratio: { amazon: number; ebay: number };
  search_cache_ttl_seconds: number;
  home_cache_ttl_seconds: number;
  offers_cache_ttl_seconds: number;
  negative_cache_ttl_seconds: number;
  ebay_cache_ttl_seconds: number;
  // Smart Live settings
  amazon_live_search_enabled: boolean;
  amazon_live_category_enabled: boolean;
  amazon_live_home_enabled: boolean;
  amazon_live_max_pages: number;
  amazon_home_prewarm_enabled: boolean;
  amazon_home_prewarm_interval_minutes: number;
  amazon_home_prewarm_max_items_per_section: number;
  amazon_query_generic_blocklist: string[];
  amazon_live_min_query_len: number;
  // Home rotation settings
  home_rotation_interval_minutes: number;
  home_rotation_mode: string;
  home_avoid_repeat_days: number;
  home_items_per_section: number;
  ebay_home_cache_ttl_seconds: number;
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

const DEFAULT_SETTINGS: CatalogSettings = {
  catalog_provider_mode: 'mixed',
  amazon_enabled: true,
  ebay_enabled: true,
  amazon_max_results_per_query: 200,
  amazon_max_calls_per_hour: 100,
  amazon_budget_window: 'hour',
  mixed_amazon_first_count: 60,
  mixed_blend_ratio: { amazon: 1, ebay: 2 },
  search_cache_ttl_seconds: 172800,
  home_cache_ttl_seconds: 43200,
  offers_cache_ttl_seconds: 43200,
  negative_cache_ttl_seconds: 120,
  ebay_cache_ttl_seconds: 0,
  // Smart Live settings
  amazon_live_search_enabled: true,
  amazon_live_category_enabled: true,
  amazon_live_home_enabled: false,
  amazon_live_max_pages: 1,
  amazon_home_prewarm_enabled: true,
  amazon_home_prewarm_interval_minutes: 720,
  amazon_home_prewarm_max_items_per_section: 200,
  amazon_query_generic_blocklist: ["shoes", "clothes", "home", "house", "decor", "vetement", "chaussure", "maison"],
  amazon_live_min_query_len: 3,
  // Home rotation settings
  home_rotation_interval_minutes: 720,
  home_rotation_mode: 'timebucket',
  home_avoid_repeat_days: 7,
  home_items_per_section: 120,
  ebay_home_cache_ttl_seconds: 1800,
};

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
  { key: 'beauty_health', label: 'Beauty & Health' },
  { key: 'cameras_photo', label: 'Cameras & Photo' },
  { key: 'collectibles', label: 'Collectibles' },
];

interface CategoryOverride {
  category_key: string;
  max_item_age_days: number | null;
  price_refresh_days: number | null;
  availability_refresh_days: number | null;
  db_min_results: number | null;
  enabled: boolean;
}

export default function CatalogSourcesSettings() {
  const { language } = useLanguage();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<CatalogSettings>(DEFAULT_SETTINGS);
  const [isDirty, setIsDirty] = useState(false);
  
  // Cache settings state (merged from CacheSettings)
  const [searchTtlDays, setSearchTtlDays] = useState(2);
  const [categoriesTtlDays, setCategoriesTtlDays] = useState(1);
  const [maxItemAgeDays, setMaxItemAgeDays] = useState(30);
  const [priceRefreshDays, setPriceRefreshDays] = useState(3);
  const [availRefreshDays, setAvailRefreshDays] = useState(3);
  const [dbMinResults, setDbMinResults] = useState(5);
  const [categoryOverrides, setCategoryOverrides] = useState<CategoryOverride[]>(
    CANONICAL_CATEGORIES.map(c => ({
      category_key: c.key, max_item_age_days: null, price_refresh_days: null,
      availability_refresh_days: null, db_min_results: null, enabled: true,
    }))
  );
  
  // Prewarm job polling state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<PrewarmJob | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: rawSettings, isLoading, refetch } = useQuery({
    queryKey: ['admin-catalog-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('key, value, updated_at')
        .in('key', Object.keys(DEFAULT_SETTINGS));
      
      if (error) throw error;
      return data as SettingRow[];
    },
  });

  // Cache settings queries (merged from CacheSettings)
  const { data: cacheSettings } = useQuery({
    queryKey: ['catalog-cache-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_cache_settings').select('*').eq('key', 'default').maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: globalTtl } = useQuery({
    queryKey: ['admin-ttl-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-service', { body: { action: 'catalog_settings', method: 'GET' } });
      if (error) throw error;
      return data;
    },
  });
  const { data: catOverridesData } = useQuery({
    queryKey: ['catalog-category-ttl'],
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_category_ttl' as any).select('*');
      if (error) throw error;
      return data as any[];
    },
  });
  useEffect(() => {
    if (cacheSettings) {
      setSearchTtlDays(Math.round((cacheSettings.search_expires_minutes ?? 2880) / 1440));
      setCategoriesTtlDays(Math.round((cacheSettings.home_expires_minutes ?? 1440) / 1440));
    }
  }, [cacheSettings]);
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
        return ov ? { ...c, ...ov } : c;
      }));
    }
  }, [catOverridesData]);

  // Cache mutations
  const clearCacheMutation = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc('admin_clear_search_cache'); if (error) throw error; return data; },
    onSuccess: (data: any) => { toast({ title: language === 'fr' ? 'Cache vidé' : 'Cache cleared', description: `catalog=${data.deleted_catalog_cache}, proxy=${data.deleted_search_proxy_cache}` }); },
    onError: (error: any) => { toast({ title: 'Error', description: error.message, variant: 'destructive' }); },
  });
  const saveResponseCacheMutation = useMutation({
    mutationFn: async () => {
      const searchExpiresMin = searchTtlDays * 1440;
      const homeExpiresMin = categoriesTtlDays * 1440;
      const { error } = await supabase.from('catalog_cache_settings').upsert({ key: 'default', search_expires_minutes: searchExpiresMin, search_stale_minutes: Math.floor(searchExpiresMin * 0.5), home_expires_minutes: homeExpiresMin, home_stale_minutes: Math.floor(homeExpiresMin * 0.5), offers_expires_minutes: homeExpiresMin, offers_stale_minutes: Math.floor(homeExpiresMin * 0.5), negative_expires_seconds: 120, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['catalog-cache-settings'] }); toast({ title: language === 'fr' ? 'Cache réponse sauvegardé' : 'Response cache saved' }); },
    onError: (error: any) => { toast({ title: 'Error', description: error.message, variant: 'destructive' }); },
  });
  const saveGlobalTtlMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-service', { body: { action: 'catalog_settings', method: 'POST', updates: { global_max_item_age_days: String(maxItemAgeDays), global_price_refresh_days: String(priceRefreshDays), global_availability_refresh_days: String(availRefreshDays), db_search_min_results: String(dbMinResults) } } });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Failed');
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-ttl-settings'] }); toast({ title: language === 'fr' ? 'Paramètres TTL sauvegardés' : 'TTL Settings saved' }); },
    onError: (error: any) => { toast({ title: 'Error', description: error.message, variant: 'destructive' }); },
  });
  const saveCategoryOverridesMutation = useMutation({
    mutationFn: async () => {
      const toSave = categoryOverrides.filter(c => c.max_item_age_days != null || c.price_refresh_days != null || c.availability_refresh_days != null || c.db_min_results != null || !c.enabled);
      if (toSave.length === 0) return;
      const { data, error } = await supabase.functions.invoke('admin-service', { body: { action: 'catalog_settings', method: 'PUT', categoryOverrides: toSave } });
      if (error) throw error;
      if (!data?.success) throw new Error('Failed to save overrides');
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['catalog-category-ttl'] }); toast({ title: language === 'fr' ? 'Overrides sauvegardés' : 'Category overrides saved' }); },
    onError: (error: any) => { toast({ title: 'Error', description: error.message, variant: 'destructive' }); },
  });
  const applyGlobalToAllMutation = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.functions.invoke('admin-service', { body: { action: 'catalog_settings', method: 'DELETE' } }); if (error) throw error; return data; },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-category-ttl'] });
      setCategoryOverrides(CANONICAL_CATEGORIES.map(c => ({ category_key: c.key, max_item_age_days: null, price_refresh_days: null, availability_refresh_days: null, db_min_results: null, enabled: true })));
      toast({ title: language === 'fr' ? 'Overrides effacés' : 'All overrides cleared' });
    },
    onError: (error: any) => { toast({ title: 'Error', description: error.message, variant: 'destructive' }); },
  });
  const updateOverride = (key: string, field: string, value: any) => {
    setCategoryOverrides(prev => prev.map(c => c.category_key === key ? { ...c, [field]: value } : c));
  };
  const priceRefreshWarning = priceRefreshDays > maxItemAgeDays;

  useEffect(() => {
    if (rawSettings) {
      const parsed: Partial<CatalogSettings> = {};
      
      rawSettings.forEach(row => {
        try {
          const value = JSON.parse(row.value);
          (parsed as Record<string, unknown>)[row.key] = value;
        } catch {
          (parsed as Record<string, unknown>)[row.key] = row.value;
        }
      });

      setSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
      });
    }
  }, [rawSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates: Record<string, unknown> = {
        catalog_provider_mode: settings.catalog_provider_mode,
        amazon_enabled: settings.amazon_enabled,
        ebay_enabled: settings.ebay_enabled,
        amazon_max_results_per_query: settings.amazon_max_results_per_query,
        amazon_max_calls_per_hour: settings.amazon_max_calls_per_hour,
        amazon_budget_window: settings.amazon_budget_window,
        mixed_amazon_first_count: settings.mixed_amazon_first_count,
        mixed_blend_ratio: settings.mixed_blend_ratio,
        search_cache_ttl_seconds: settings.search_cache_ttl_seconds,
        home_cache_ttl_seconds: settings.home_cache_ttl_seconds,
        offers_cache_ttl_seconds: settings.offers_cache_ttl_seconds,
        negative_cache_ttl_seconds: settings.negative_cache_ttl_seconds,
        ebay_cache_ttl_seconds: settings.ebay_cache_ttl_seconds,
        // New Smart Live settings
        amazon_live_search_enabled: settings.amazon_live_search_enabled,
        amazon_live_category_enabled: settings.amazon_live_category_enabled,
        amazon_live_home_enabled: settings.amazon_live_home_enabled,
        amazon_live_max_pages: settings.amazon_live_max_pages,
        amazon_home_prewarm_enabled: settings.amazon_home_prewarm_enabled,
        amazon_home_prewarm_interval_minutes: settings.amazon_home_prewarm_interval_minutes,
        amazon_home_prewarm_max_items_per_section: settings.amazon_home_prewarm_max_items_per_section,
        amazon_query_generic_blocklist: settings.amazon_query_generic_blocklist,
        amazon_live_min_query_len: settings.amazon_live_min_query_len,
        // Home rotation settings
        home_rotation_interval_minutes: settings.home_rotation_interval_minutes,
        home_rotation_mode: settings.home_rotation_mode,
        home_avoid_repeat_days: settings.home_avoid_repeat_days,
        home_items_per_section: settings.home_items_per_section,
        ebay_home_cache_ttl_seconds: settings.ebay_home_cache_ttl_seconds,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('admin-service', {
        body: { action: 'catalog_settings', method: 'POST', updates },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-catalog-settings'] });
      setIsDirty(false);
      toast({
        title: language === 'fr' ? 'Paramètres sauvegardés' : 'Settings saved',
        description: language === 'fr' 
          ? 'Les changements sont actifs immédiatement.'
          : 'Changes are active immediately.',
      });
    },
    onError: (error) => {
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      });
    },
  });

  const handleChange = <K extends keyof CatalogSettings>(key: K, value: CatalogSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const handleSave = () => {
    saveMutation.mutate();
  };

  // Poll for job status with stall detection
  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const { data: job, error } = await supabase
        .from('prewarm_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error || !job) {
        console.error('Failed to fetch job status:', error);
        setActiveJobId(null);
        setJobProgress(null);
        return;
      }

      // Stall detection: check if job has been stuck for too long
      const STALL_THRESHOLD_SECONDS = 90; // 90 seconds without heartbeat = stalled
      const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes max polling
      
      const heartbeatTime = job.last_heartbeat ? new Date(job.last_heartbeat).getTime() : null;
      const startedTime = job.started_at ? new Date(job.started_at).getTime() : Date.now();
      const now = Date.now();
      
      const secondsSinceHeartbeat = heartbeatTime ? (now - heartbeatTime) / 1000 : 0;
      const msSinceStart = now - startedTime;
      
      // Check for stall
      if (job.status === 'processing' && heartbeatTime && secondsSinceHeartbeat > STALL_THRESHOLD_SECONDS) {
        console.log(`Job ${jobId} appears stalled - ${secondsSinceHeartbeat}s since last heartbeat`);
        setJobProgress({ ...job, status: 'stalled' } as PrewarmJob);
        setActiveJobId(null);
        
        toast({
          title: language === 'fr' ? 'Job bloqué' : 'Job stalled',
          description: language === 'fr'
            ? `Pas de progression depuis ${Math.round(secondsSinceHeartbeat)}s. Vous pouvez réessayer.`
            : `No progress for ${Math.round(secondsSinceHeartbeat)}s. You can retry.`,
          variant: 'destructive',
        });
        return;
      }
      
      // Check for max polling duration
      if (msSinceStart > MAX_POLL_DURATION_MS) {
        console.log(`Job ${jobId} polling timed out after ${msSinceStart}ms`);
        setActiveJobId(null);
        
        toast({
          title: language === 'fr' ? 'Délai dépassé' : 'Timeout',
          description: language === 'fr'
            ? 'Le job prend trop de temps. Vérifiez les logs.'
            : 'Job is taking too long. Check logs.',
          variant: 'destructive',
        });
        return;
      }

      setJobProgress(job as PrewarmJob);

      // Check if job is complete
      if (job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'failed') {
        setActiveJobId(null);
        
        if (job.status === 'failed') {
          toast({
            title: language === 'fr' ? 'Erreur' : 'Error',
            description: job.error_message || (language === 'fr' ? 'Le rafraîchissement a échoué' : 'Refresh failed'),
            variant: 'destructive',
          });
        } else {
          const totalFetched = (job.amazon_fetched || 0) + (job.ebay_fetched || 0);
          toast({
            title: language === 'fr' ? '✓ Accueil rafraîchi!' : '✓ Home refreshed!',
            description: language === 'fr' 
              ? `${job.sections_completed}/${job.sections_total} sections, ${totalFetched} produits`
              : `${job.sections_completed}/${job.sections_total} sections, ${totalFetched} products`,
          });
        }
        
        // Clear progress after a delay
        setTimeout(() => setJobProgress(null), 5000);
        return;
      }

      // Continue polling if still processing
      pollingRef.current = setTimeout(() => pollJobStatus(jobId), 2000);
    } catch (err) {
      console.error('Polling error:', err);
      setActiveJobId(null);
      setJobProgress(null);
    }
  }, [language]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }
    };
  }, []);

  const prewarmMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('catalog-service?action=prewarm', {
        method: 'POST',
        body: {},
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) throw response.error;
      
      const result = response.data;
      if (!result?.ok) {
        throw new Error(result?.error || 'Prewarm failed');
      }
      
      return result;
    },
    onSuccess: (data) => {
      // Start polling for job progress
      if (data.jobId) {
        setActiveJobId(data.jobId);
        setJobProgress({
          id: data.jobId,
          status: 'pending',
          rotation_key: data.rotationKey,
          sections_total: data.sectionsTotal || 8,
          sections_completed: 0,
          current_section: null,
          amazon_fetched: 0,
          ebay_fetched: 0,
          mixed_total: 0,
          error_message: null,
          started_at: null,
          completed_at: null,
          created_at: new Date().toISOString(),
          last_heartbeat: null,
        });
        
        toast({
          title: language === 'fr' ? 'Rafraîchissement démarré' : 'Refresh started',
          description: language === 'fr' 
            ? 'Traitement en arrière-plan...'
            : 'Processing in background...',
        });
        
        // Start polling
        pollingRef.current = setTimeout(() => pollJobStatus(data.jobId), 1500);
      }
    },
    onError: (error) => {
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: error instanceof Error ? error.message : 'Failed to start refresh',
        variant: 'destructive',
      });
    },
  });

  const formatSeconds = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  };

  const getLastUpdated = (): string | null => {
    if (!rawSettings || rawSettings.length === 0) return null;
    const latest = rawSettings.reduce((a, b) => 
      new Date(a.updated_at) > new Date(b.updated_at) ? a : b
    );
    return latest.updated_at;
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

  const lastUpdated = getLastUpdated();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Store className="h-6 w-6" />
            {language === 'fr' ? 'Sources du Catalogue' : 'Catalog Sources'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {language === 'fr'
              ? 'Contrôlez les fournisseurs de produits et les limites API.'
              : 'Control product providers and API limits.'}
          </p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={!isDirty || saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {language === 'fr' ? 'Sauvegarder' : 'Save Changes'}
        </Button>
      </div>

      {/* Provider Mode & Activation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {language === 'fr' ? 'Mode Fournisseur' : 'Provider Mode'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? "Choisissez comment les produits sont récupérés et mélangés."
              : 'Choose how products are fetched and mixed.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Mode Selector */}
          <div className="space-y-2">
            <Label>{language === 'fr' ? 'Mode' : 'Mode'}</Label>
            <Select 
              value={settings.catalog_provider_mode}
              onValueChange={(value) => handleChange('catalog_provider_mode', value)}
            >
              <SelectTrigger className="w-full md:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mixed">
                  <span className="flex items-center gap-2">
                    <Shuffle className="h-4 w-4" />
                    {language === 'fr' ? 'Mixte (Amazon + eBay)' : 'Mixed (Amazon + eBay)'}
                  </span>
                </SelectItem>
                <SelectItem value="ebay">
                  <span className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    {language === 'fr' ? 'eBay Uniquement' : 'eBay Only'}
                  </span>
                </SelectItem>
                <SelectItem value="amazon">
                  <span className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    {language === 'fr' ? 'Amazon Uniquement' : 'Amazon Only'}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Provider Toggles */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Amazon</Label>
                <p className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'Produits depuis la base de données' : 'Products from database cache'}
                </p>
              </div>
              <Switch 
                checked={settings.amazon_enabled}
                onCheckedChange={(checked) => handleChange('amazon_enabled', checked)}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">eBay</Label>
                <p className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'Recherche en temps réel' : 'Live API search'}
                </p>
              </div>
              <Switch 
                checked={settings.ebay_enabled}
                onCheckedChange={(checked) => handleChange('ebay_enabled', checked)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Amazon Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {language === 'fr' ? 'Limites Amazon' : 'Amazon Limits'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? "Contrôlez les coûts API Amazon avec des limites de budget."
              : 'Control Amazon API costs with budget limits.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max_results">
                {language === 'fr' ? 'Max résultats par requête' : 'Max results per query'}
              </Label>
              <Input
                id="max_results"
                type="number"
                min={50}
                max={500}
                value={settings.amazon_max_results_per_query}
                onChange={(e) => handleChange('amazon_max_results_per_query', parseInt(e.target.value) || 200)}
              />
              <p className="text-xs text-muted-foreground">50-500</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max_calls">
                {language === 'fr' ? 'Max appels par fenêtre' : 'Max calls per window'}
              </Label>
              <Input
                id="max_calls"
                type="number"
                min={10}
                max={1000}
                value={settings.amazon_max_calls_per_hour}
                onChange={(e) => handleChange('amazon_max_calls_per_hour', parseInt(e.target.value) || 100)}
              />
              <p className="text-xs text-muted-foreground">10-1000</p>
            </div>

            <div className="space-y-2">
              <Label>{language === 'fr' ? 'Fenêtre de budget' : 'Budget window'}</Label>
              <Select 
                value={settings.amazon_budget_window}
                onValueChange={(value) => handleChange('amazon_budget_window', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour">{language === 'fr' ? 'Par heure' : 'Per hour'}</SelectItem>
                  <SelectItem value="day">{language === 'fr' ? 'Par jour' : 'Per day'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mixing Strategy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shuffle className="h-5 w-5" />
            {language === 'fr' ? 'Stratégie de Mélange' : 'Mixing Strategy'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? "Comment les résultats Amazon et eBay sont ordonnés."
              : 'How Amazon and eBay results are ordered.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="amazon_first_count">
                {language === 'fr' ? "Premiers items Amazon (N)" : 'Amazon-first count (N)'}
              </Label>
              <Input
                id="amazon_first_count"
                type="number"
                min={0}
                max={200}
                value={settings.mixed_amazon_first_count}
                onChange={(e) => handleChange('mixed_amazon_first_count', parseInt(e.target.value) || 60)}
              />
              <p className="text-xs text-muted-foreground">
                {language === 'fr'
                  ? 'Nombre de produits Amazon en premier avant le mélange'
                  : 'Number of Amazon products first before blending'}
              </p>
            </div>

            <div className="space-y-3">
              <Label>{language === 'fr' ? 'Ratio de mélange' : 'Blend ratio'}</Label>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Amazon</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={settings.mixed_blend_ratio.amazon}
                    onChange={(e) => handleChange('mixed_blend_ratio', {
                      ...settings.mixed_blend_ratio,
                      amazon: parseInt(e.target.value) || 1,
                    })}
                  />
                </div>
                <span className="text-muted-foreground font-medium pt-5">:</span>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">eBay</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={settings.mixed_blend_ratio.ebay}
                    onChange={(e) => handleChange('mixed_blend_ratio', {
                      ...settings.mixed_blend_ratio,
                      ebay: parseInt(e.target.value) || 2,
                    })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {language === 'fr'
                  ? `${settings.mixed_blend_ratio.amazon} Amazon pour ${settings.mixed_blend_ratio.ebay} eBay après la phase initiale`
                  : `${settings.mixed_blend_ratio.amazon} Amazon for every ${settings.mixed_blend_ratio.ebay} eBay after initial phase`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Smart Amazon Live Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Flame className="h-5 w-5" />
            {language === 'fr' ? 'Amazon Live Intelligent' : 'Smart Amazon Live'}
          </CardTitle>
          <CardDescription>
            {language === 'fr'
              ? "Contrôlez quand Amazon utilise l'API live vs le cache."
              : 'Control when Amazon uses live API vs cache.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Live Toggles per Endpoint */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  {language === 'fr' ? 'Recherche Live' : 'Search Live'}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {language === 'fr' ? 'API live pour recherche' : 'Live API for search'}
                </p>
              </div>
              <Switch 
                checked={settings.amazon_live_search_enabled}
                onCheckedChange={(checked) => handleChange('amazon_live_search_enabled', checked)}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  {language === 'fr' ? 'Catégorie Live' : 'Category Live'}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {language === 'fr' ? 'API live pour catégories' : 'Live API for categories'}
                </p>
              </div>
              <Switch 
                checked={settings.amazon_live_category_enabled}
                onCheckedChange={(checked) => handleChange('amazon_live_category_enabled', checked)}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  {language === 'fr' ? 'Accueil Live' : 'Home Live'}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {language === 'fr' ? 'Désactivé = prewarm' : 'Off = prewarm cache'}
                </p>
              </div>
              <Switch 
                checked={settings.amazon_live_home_enabled}
                onCheckedChange={(checked) => handleChange('amazon_live_home_enabled', checked)}
              />
            </div>
          </div>

          <Separator />

          {/* Live Limits */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>
                {language === 'fr' ? 'Pages live max' : 'Max live pages'}
              </Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={settings.amazon_live_max_pages}
                onChange={(e) => handleChange('amazon_live_max_pages', parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                {language === 'fr' ? 'Pages après = cache seulement' : 'Pages after = cache only'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>
                {language === 'fr' ? 'Longueur min requête' : 'Min query length'}
              </Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.amazon_live_min_query_len}
                onChange={(e) => handleChange('amazon_live_min_query_len', parseInt(e.target.value) || 3)}
              />
              <p className="text-xs text-muted-foreground">
                {language === 'fr' ? 'Requêtes courtes = cache' : 'Short queries = cache only'}
              </p>
            </div>
          </div>

          <Separator />

          {/* Prewarm Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-medium">
                  {language === 'fr' ? 'Prewarm Cache Accueil' : 'Home Cache Prewarm'}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {language === 'fr' 
                    ? 'Pré-charge les produits Amazon pour la page d\'accueil'
                    : 'Pre-loads Amazon products for home page'}
                </p>
              </div>
              <Button 
                variant="outline" 
                onClick={() => prewarmMutation.mutate()}
                disabled={prewarmMutation.isPending}
                className="gap-2"
              >
                {prewarmMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Flame className="h-4 w-4" />
                )}
                {language === 'fr' ? 'Rafraîchir Maintenant' : 'Refresh Now'}
              </Button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  {language === 'fr' ? 'Max items par section' : 'Max items per section'}
                </Label>
                <Input
                  type="number"
                  min={50}
                  max={500}
                  value={settings.amazon_home_prewarm_max_items_per_section}
                  onChange={(e) => handleChange('amazon_home_prewarm_max_items_per_section', parseInt(e.target.value) || 200)}
                />
              </div>

              <div className="space-y-2">
                <Label>
                  {language === 'fr' ? 'Intervalle (minutes)' : 'Interval (minutes)'}
                </Label>
                <Input
                  type="number"
                  min={60}
                  max={1440}
                  value={settings.amazon_home_prewarm_interval_minutes}
                  onChange={(e) => handleChange('amazon_home_prewarm_interval_minutes', parseInt(e.target.value) || 720)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Home Rotation Settings */}
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                {language === 'fr' ? 'Rotation Accueil (12h)' : 'Home Rotation (12h)'}
              </CardTitle>
              <CardDescription>
                {language === 'fr'
                  ? "Contrôlez la rotation automatique du contenu de la page d'accueil."
                  : 'Control automatic home page content rotation.'}
              </CardDescription>
            </div>
            <Button
              variant="default"
              size="lg"
              onClick={() => prewarmMutation.mutate()}
              disabled={prewarmMutation.isPending || !!activeJobId}
              className="gap-2 bg-primary hover:bg-primary/90"
            >
              {(prewarmMutation.isPending || activeJobId) ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : (
                <RefreshCw className="h-5 w-5" />
              )}
              {language === 'fr' ? 'Rafraîchir Maintenant' : 'Refresh Home Now'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress Display */}
          {jobProgress && (
            <div className={`p-4 rounded-lg border space-y-3 ${
              jobProgress.status === 'stalled' ? 'bg-destructive/10 border-destructive/30' : 'bg-muted/30'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {jobProgress.status === 'completed' || jobProgress.status === 'completed_with_errors' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : jobProgress.status === 'failed' ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : jobProgress.status === 'stalled' ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                  )}
                  <span className="font-medium">
                    {jobProgress.status === 'pending' && (language === 'fr' ? 'Démarrage...' : 'Starting...')}
                    {jobProgress.status === 'processing' && (language === 'fr' ? 'Traitement en cours...' : 'Processing...')}
                    {jobProgress.status === 'completed' && (language === 'fr' ? 'Terminé!' : 'Complete!')}
                    {jobProgress.status === 'completed_with_errors' && (language === 'fr' ? 'Terminé avec erreurs' : 'Completed with errors')}
                    {jobProgress.status === 'failed' && (language === 'fr' ? 'Échec' : 'Failed')}
                    {jobProgress.status === 'stalled' && (language === 'fr' ? 'Bloqué - Réessayer?' : 'Stalled - Retry?')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {jobProgress.sections_completed}/{jobProgress.sections_total} sections
                  </span>
                  {jobProgress.status === 'stalled' && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setJobProgress(null);
                        prewarmMutation.mutate();
                      }}
                      disabled={prewarmMutation.isPending}
                      className="gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {language === 'fr' ? 'Réessayer' : 'Retry'}
                    </Button>
                  )}
                </div>
              </div>
              
              <Progress 
                value={(jobProgress.sections_completed / jobProgress.sections_total) * 100} 
                className={`h-2 ${jobProgress.status === 'stalled' ? 'bg-destructive/20' : ''}`}
              />
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {jobProgress.current_section && (
                    <>
                      {language === 'fr' ? 'Section: ' : 'Section: '}
                      <span className="font-medium text-foreground">{jobProgress.current_section}</span>
                    </>
                  )}
                  {jobProgress.status === 'stalled' && (
                    <span className="text-destructive ml-2">
                      {language === 'fr' ? '(pas de réponse)' : '(no response)'}
                    </span>
                  )}
                </span>
                <span>
                  Amazon: {jobProgress.amazon_fetched} | eBay: {jobProgress.ebay_fetched} | Mixed: {jobProgress.mixed_total}
                </span>
              </div>
            </div>
          )}

          {/* Manual Refresh Info */}
          {!jobProgress && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border">
              <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground">
                  {language === 'fr' ? 'Rafraîchissement manuel' : 'Manual Refresh'}
                </p>
                <p className="text-muted-foreground">
                  {language === 'fr' 
                    ? "Cliquez sur 'Rafraîchir Maintenant' pour mettre à jour immédiatement les produits de la page d'accueil. La rotation automatique de 12h reste active."
                    : "Click 'Refresh Home Now' to immediately update home page products. The automatic 12h rotation remains active."}
                </p>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>
                {language === 'fr' ? 'Intervalle rotation (min)' : 'Rotation interval (min)'}
              </Label>
              <Input
                type="number"
                min={60}
                max={1440}
                value={settings.home_rotation_interval_minutes}
                onChange={(e) => handleChange('home_rotation_interval_minutes', parseInt(e.target.value) || 720)}
              />
              <p className="text-xs text-muted-foreground">720 = 12h</p>
            </div>

            <div className="space-y-2">
              <Label>
                {language === 'fr' ? 'Éviter répétitions (jours)' : 'Avoid repeat (days)'}
              </Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={settings.home_avoid_repeat_days}
                onChange={(e) => handleChange('home_avoid_repeat_days', parseInt(e.target.value) || 7)}
              />
            </div>

            <div className="space-y-2">
              <Label>
                {language === 'fr' ? 'Items par section' : 'Items per section'}
              </Label>
              <Input
                type="number"
                min={20}
                max={200}
                value={settings.home_items_per_section}
                onChange={(e) => handleChange('home_items_per_section', parseInt(e.target.value) || 120)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ Cache & Performance (merged from CacheSettings) ═══ */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {language === 'fr' ? 'Rétention & Rafraîchissement (Global)' : 'Item Retention & Refresh (Global)'}
          </CardTitle>
          <CardDescription>{language === 'fr' ? 'Paramètres globaux sauf override par catégorie.' : 'Global settings unless overridden per category.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>{language === 'fr' ? 'Garder les items (jours)' : 'Keep items (days)'}</Label>
              <Input type="number" min={7} max={90} value={maxItemAgeDays} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setMaxItemAgeDays(v); }} />
            </div>
            <div className="space-y-2">
              <Label>{language === 'fr' ? 'Rafraîchir prix (jours)' : 'Refresh prices (days)'}</Label>
              <Input type="number" min={1} max={14} value={priceRefreshDays} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setPriceRefreshDays(v); }} />
              {priceRefreshWarning && <p className="text-xs text-destructive">⚠️ Refresh &gt; retention</p>}
            </div>
            <div className="space-y-2">
              <Label>{language === 'fr' ? 'Rafraîchir disponibilité (jours)' : 'Refresh availability (days)'}</Label>
              <Input type="number" min={1} max={14} value={availRefreshDays} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setAvailRefreshDays(v); }} />
            </div>
            <div className="space-y-2">
              <Label>{language === 'fr' ? 'Min résultats DB' : 'Min DB results'}</Label>
              <Input type="number" min={3} max={50} value={dbMinResults} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setDbMinResults(v); }} />
            </div>
          </div>
          <Button size="lg" onClick={() => saveGlobalTtlMutation.mutate()} disabled={saveGlobalTtlMutation.isPending || priceRefreshWarning} className="gap-2">
            {saveGlobalTtlMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {language === 'fr' ? '💾 Sauvegarder Global' : '💾 Save Global Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Per-Category Overrides */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><Settings2 className="h-5 w-5" />{language === 'fr' ? 'Overrides par Catégorie' : 'Per-Category Overrides'}</CardTitle>
              <CardDescription>{language === 'fr' ? 'Vide = hérite du global.' : 'Empty = inherits global.'}</CardDescription>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1"><RefreshCw className="h-3.5 w-3.5" />{language === 'fr' ? 'Réinitialiser' : 'Reset All'}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{language === 'fr' ? 'Effacer overrides ?' : 'Clear all overrides?'}</AlertDialogTitle>
                  <AlertDialogDescription>{language === 'fr' ? 'Héritera du global.' : 'All will inherit global.'}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{language === 'fr' ? 'Annuler' : 'Cancel'}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => applyGlobalToAllMutation.mutate()}>{language === 'fr' ? 'Confirmer' : 'Confirm'}</AlertDialogAction>
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
                  <TableHead>Category</TableHead>
                  <TableHead className="text-center">Max Age</TableHead>
                  <TableHead className="text-center">Price</TableHead>
                  <TableHead className="text-center">Avail</TableHead>
                  <TableHead className="text-center">Min DB</TableHead>
                  <TableHead className="text-center">On</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CANONICAL_CATEGORIES.map(cat => {
                  const ov = categoryOverrides.find(c => c.category_key === cat.key)!;
                  return (
                    <TableRow key={cat.key}>
                      <TableCell className="font-medium text-sm">{cat.label}</TableCell>
                      <TableCell className="text-center"><Input type="number" min={7} max={90} className="w-16 mx-auto text-center h-8" placeholder={String(maxItemAgeDays)} value={ov.max_item_age_days ?? ''} onChange={e => updateOverride(cat.key, 'max_item_age_days', e.target.value ? parseInt(e.target.value, 10) : null)} /></TableCell>
                      <TableCell className="text-center"><Input type="number" min={1} max={14} className="w-16 mx-auto text-center h-8" placeholder={String(priceRefreshDays)} value={ov.price_refresh_days ?? ''} onChange={e => updateOverride(cat.key, 'price_refresh_days', e.target.value ? parseInt(e.target.value, 10) : null)} /></TableCell>
                      <TableCell className="text-center"><Input type="number" min={1} max={14} className="w-16 mx-auto text-center h-8" placeholder={String(availRefreshDays)} value={ov.availability_refresh_days ?? ''} onChange={e => updateOverride(cat.key, 'availability_refresh_days', e.target.value ? parseInt(e.target.value, 10) : null)} /></TableCell>
                      <TableCell className="text-center"><Input type="number" min={3} max={50} className="w-16 mx-auto text-center h-8" placeholder={String(dbMinResults)} value={ov.db_min_results ?? ''} onChange={e => updateOverride(cat.key, 'db_min_results', e.target.value ? parseInt(e.target.value, 10) : null)} /></TableCell>
                      <TableCell className="text-center"><Switch checked={ov.enabled} onCheckedChange={v => updateOverride(cat.key, 'enabled', v)} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="pt-4">
            <Button size="lg" onClick={() => saveCategoryOverridesMutation.mutate()} disabled={saveCategoryOverridesMutation.isPending} className="gap-2">
              {saveCategoryOverridesMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {language === 'fr' ? '💾 Sauvegarder Overrides' : '💾 Save Overrides'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Response Cache TTL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" />{language === 'fr' ? 'Cache Réponse API' : 'API Response Cache'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Search className="h-4 w-4 text-primary" />{language === 'fr' ? 'Cache Recherche (jours)' : 'Search Cache (days)'}</Label>
              <Input type="number" min={1} max={30} value={searchTtlDays} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setSearchTtlDays(v); }} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Home className="h-4 w-4 text-primary" />{language === 'fr' ? 'Cache Accueil (jours)' : 'Home Cache (days)'}</Label>
              <Input type="number" min={1} max={30} value={categoriesTtlDays} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setCategoriesTtlDays(v); }} />
            </div>
          </div>
          <Button onClick={() => saveResponseCacheMutation.mutate()} disabled={saveResponseCacheMutation.isPending} className="gap-2">
            {saveResponseCacheMutation.isPending && <RefreshCw className="h-4 w-4 animate-spin" />}
            {language === 'fr' ? 'Enregistrer' : 'Save'}
          </Button>
        </CardContent>
      </Card>

      {/* Clear Cache */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" />{language === 'fr' ? 'Vider le Cache' : 'Clear Search Cache'}</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-destructive/30 text-destructive" disabled={clearCacheMutation.isPending}>
                {clearCacheMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {language === 'fr' ? 'Vider' : 'Clear Cache'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{language === 'fr' ? 'Vider le cache ?' : 'Clear cache?'}</AlertDialogTitle>
                <AlertDialogDescription>{language === 'fr' ? 'Supprime les résultats cachés.' : 'Removes cached results.'}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{language === 'fr' ? 'Annuler' : 'Cancel'}</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearCacheMutation.mutate()}>{language === 'fr' ? 'Vider' : 'Clear'}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Status Footer */}
      {lastUpdated && (
        <p className="text-xs text-muted-foreground text-center">
          {language === 'fr' ? 'Dernière mise à jour:' : 'Last updated:'}{' '}
          {format(new Date(lastUpdated), 'PPpp')}
        </p>
      )}
    </div>
  );
}
