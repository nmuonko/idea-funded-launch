import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Hammer, Plus, RotateCcw, Loader2 } from 'lucide-react';

const ALL_CATEGORIES = [
  'phones', 'electronics', 'audio_music', 'gaming', 'vehicles', 'home_garden',
  'toys', 'sporting_goods', 'jewelry_watches', 'parts_accessories', 'refurbished',
  'clothing', 'shoes_sneakers', 'cameras_photo', 'beauty_health', 'collectibles',
  'electronics_phones', 'electronics_gaming', 'electronics_audio', 'electronics_computers',
];

async function fetchSources() {
  const { data, error } = await supabase.functions.invoke('admin-catalog-items?mode=list', { method: 'GET' });
  if (error) throw error;
  return data;
}

export default function CatalogBuilder() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();

  // Fetch sources directly
  const { data: sources, isLoading: sourcesLoading } = useQuery({
    queryKey: ['catalog-builder-sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_builder_sources' as any)
        .select('*, catalog_builder_state(*)')
        .order('priority', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    staleTime: 30_000,
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['catalog-builder-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_builder_runs' as any)
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 30_000,
  });

  // Add source form state
  const [newSource, setNewSource] = useState({
    category_key: '',
    provider: 'ebay',
    source_type: 'seed_query',
    source_value: '',
    priority: 10,
  });

  const addSourceMutation = useMutation({
    mutationFn: async (source: typeof newSource) => {
      const { error } = await supabase
        .from('catalog_builder_sources' as any)
        .insert(source);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-builder-sources'] });
      toast.success('Source added');
      setNewSource({ category_key: '', provider: 'ebay', source_type: 'seed_query', source_value: '', priority: 10 });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleSourceMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('catalog_builder_sources' as any)
        .update({ enabled })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog-builder-sources'] }),
  });

  const resetProgressMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await supabase
        .from('catalog_builder_state' as any)
        .upsert({
          source_id: sourceId,
          current_offset: 0,
          total_ingested: 0,
          exhausted: false,
          last_run_at: null,
          last_error: null,
        }, { onConflict: 'source_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-builder-sources'] });
      toast.success('Progress reset');
    },
  });

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Hammer className="h-6 w-6" />
          {language === 'fr' ? 'Constructeur de Catalogue' : 'Catalog Builder'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'fr'
            ? 'Gérer les sources d\'indexation et suivre la progression'
            : 'Manage indexing sources and track builder progress'}
        </p>
      </div>

      {/* Add Source */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Source
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Select value={newSource.category_key || '_none'} onValueChange={(v) => setNewSource(s => ({ ...s, category_key: v === '_none' ? '' : v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Select category</SelectItem>
                {ALL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={newSource.provider} onValueChange={(v) => setNewSource(s => ({ ...s, provider: v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ebay">eBay</SelectItem>
                <SelectItem value="rainforest">Amazon</SelectItem>
              </SelectContent>
            </Select>
            <Select value={newSource.source_type} onValueChange={(v) => setNewSource(s => ({ ...s, source_type: v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="seed_query">Seed Query</SelectItem>
                <SelectItem value="ebay_category">eBay Category</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Query or Category ID"
              className="h-9 text-xs"
              value={newSource.source_value}
              onChange={(e) => setNewSource(s => ({ ...s, source_value: e.target.value }))}
            />
            <Button
              size="sm"
              onClick={() => newSource.category_key && newSource.source_value && addSourceMutation.mutate(newSource)}
              disabled={!newSource.category_key || !newSource.source_value || addSourceMutation.isPending}
            >
              {addSourceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sources Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">
            Builder Sources ({sources?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">On</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="text-right">Offset</TableHead>
                  <TableHead className="text-right">Ingested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourcesLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !sources?.length ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No sources configured. Add one above.
                    </TableCell>
                  </TableRow>
                ) : (
                  sources.map((src: any) => {
                    const state = src.catalog_builder_state?.[0];
                    return (
                      <TableRow key={src.id} className={!src.enabled ? 'opacity-50' : ''}>
                        <TableCell>
                          <Switch
                            checked={src.enabled}
                            onCheckedChange={(v) => toggleSourceMutation.mutate({ id: src.id, enabled: v })}
                          />
                        </TableCell>
                        <TableCell className="text-xs">{src.category_key}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{src.provider}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{src.source_type}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{src.source_value}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{state?.current_offset || 0}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{state?.total_ingested || 0}</TableCell>
                        <TableCell>
                          {state?.exhausted ? (
                            <Badge variant="secondary" className="text-[10px]">Exhausted</Badge>
                          ) : (
                            <Badge variant="default" className="text-[10px]">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(state?.last_run_at)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => resetProgressMutation.mutate(src.id)}
                            disabled={resetProgressMutation.isPending}
                            title="Reset progress"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Runs */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">Recent Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Upserted</TableHead>
                  <TableHead className="text-right">New Unique</TableHead>
                  <TableHead className="text-right">Duplicates</TableHead>
                  <TableHead className="text-right">Rate Limited</TableHead>
                  <TableHead className="text-right">Sources</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !runs?.length ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No runs yet
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run: any) => (
                    <TableRow key={run.id}>
                      <TableCell><Badge variant="outline" className="text-[10px]">{run.provider}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtDate(run.started_at)}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{run.items_upserted}</TableCell>
                      <TableCell className="text-right text-xs font-mono text-green-600">{run.new_unique_items}</TableCell>
                      <TableCell className="text-right text-xs font-mono text-muted-foreground">{run.duplicates_skipped}</TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {run.rate_limited_count > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">{run.rate_limited_count}</Badge>
                        ) : '0'}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">{run.sources_processed}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{(run.duration_ms / 1000).toFixed(1)}s</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
