import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Database, Package, AlertTriangle, XCircle, Clock, ChevronLeft, ChevronRight,
  RefreshCw, Power, PowerOff, Search, RotateCcw, ExternalLink,
  Play, Zap, Timer, TrendingUp, ChevronDown, Heart, Activity,
  StopCircle, Plus, Loader2, CheckCircle, Rocket
} from 'lucide-react';

const ALL_CATEGORIES = [
  'phones', 'electronics', 'audio_music', 'gaming', 'vehicles', 'home_garden',
  'toys', 'sporting_goods', 'jewelry_watches', 'parts_accessories', 'refurbished',
  'clothing', 'shoes_sneakers', 'cameras_photo', 'beauty_health', 'collectibles',
];

const PAGE_SIZE = 50;

interface Filters {
  category_key: string;
  provider: string;
  is_active: string;
  q: string;
  stale_price_days: string;
  not_seen_days: string;
  sort_by: string;
  date_preset: string;
}

const defaultFilters: Filters = {
  category_key: '',
  provider: '',
  is_active: '',
  q: '',
  stale_price_days: '',
  not_seen_days: '',
  sort_by: '',
  date_preset: '',
};

async function invokeAdmin(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const { data, error } = await supabase.functions.invoke(`admin-catalog-items?${qs}`, {
    method: 'GET',
  });
  if (error) throw error;
  return data;
}

async function postAction(action: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(`admin-catalog-items?action=${action}`, {
    method: 'POST',
    body,
  });
  if (error) throw error;
  return data;
}

// ── Summary Cards ────────────────────────────────────────────────────────────
function SummaryCards({ onTotalCount }: { onTotalCount?: (count: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog-cache-summary'],
    queryFn: async () => {
      try {
        const result = await invokeAdmin({ mode: 'summary' });
        if (result?.total_count != null) return result;
      } catch (e) {
        console.warn('[CatalogCache] summary edge fn failed, using DB fallback', e);
      }
      // Fallback: direct DB count
      const { count } = await supabase
        .from('catalog_items')
        .select('*', { count: 'exact', head: true });
      return { total_count: count ?? 0 };
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data?.total_count != null && onTotalCount) {
      onTotalCount(data.total_count);
    }
  }, [data?.total_count, onTotalCount]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const total = data?.total_count ?? 0;
  const cards = [
    { label: 'Total', value: total, icon: Database, color: 'text-foreground' },
    { label: 'Active', value: data?.active_count ?? 0, icon: Package, color: 'text-green-600' },
    { label: 'Inactive', value: data?.inactive_count ?? 0, icon: PowerOff, color: 'text-muted-foreground' },
    { label: 'Added 24h', value: data?.added_24h ?? 0, icon: Rocket, color: 'text-blue-500' },
    { label: 'Stale Price', value: data?.stale_price_count ?? 0, icon: Clock, color: 'text-orange-500' },
    { label: 'Dead (≥3 fails)', value: data?.dead_count ?? 0, icon: XCircle, color: 'text-destructive' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <c.icon className={`h-5 w-5 ${c.color} shrink-0`} />
            <div>
              <p className="text-2xl font-bold">{c.value.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Fetch Products ──────────────────────────────────────────────────────────
function FetchProducts() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');
  const [provider, setProvider] = useState('ebay');
  const [quantity, setQuantity] = useState(100);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<{
    status: 'running' | 'done' | 'error';
    message: string;
    itemsFetched: number;
    target: number;
    newUnique: number;
    duplicates: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchStartTimeRef = useRef<number>(0);

  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    run_window_days: 7,
    goal_total_items: 10000,
    goal_ebay_items: 5000,
    goal_amazon_items: 5000,
    continuous: true,
  });

  const { data: status } = useQuery({
    queryKey: ['builder-status'],
    queryFn: () => invokeAdmin({ mode: 'builder-status' }),
    staleTime: 15_000,
    refetchInterval: isFetching ? 5_000 : 30_000,
  });

  const health = status?.provider_health;
  const healthMap = Array.isArray(health) 
    ? health.reduce((acc: any, h: any) => { acc[h.provider] = h; return acc; }, {})
    : health || {};
  const ebayHealthy = !healthMap.ebay || healthMap.ebay.healthy !== false;
  const amazonHealthy = !healthMap.rainforest || healthMap.rainforest.healthy !== false;

  // Poll for progress when fetching
  useEffect(() => {
    if (!isFetching) return;
    fetchStartTimeRef.current = Date.now();
    
    pollRef.current = setInterval(async () => {
      // 5-minute safety timeout
      const elapsed = Date.now() - fetchStartTimeRef.current;
      if (elapsed > 5 * 60 * 1000) {
        setFetchProgress({
          status: 'error',
          message: 'Fetch timed out after 5 minutes. The worker may still be running in the background.',
          itemsFetched: 0, target: quantity, newUnique: 0, duplicates: 0,
        });
        setIsFetching(false);
        return;
      }

      try {
        const result = await invokeAdmin({ mode: 'builder-status' });
        queryClient.setQueryData(['builder-status'], result);
        
        // Check recent runs for completion
        const recentRuns = result?.recent_runs || [];
        if (recentRuns.length > 0) {
          const latest = recentRuns[0];
          if (latest.finished_at) {
            const finishedAt = new Date(latest.finished_at).getTime();
            const now = Date.now();
            if (now - finishedAt < 30_000) {
              setFetchProgress({
                status: 'done',
                message: `Fetched ${latest.items_upserted} items from ${latest.provider}`,
                itemsFetched: latest.items_upserted,
                target: quantity,
                newUnique: latest.new_unique_items,
                duplicates: latest.duplicates_skipped,
              });
              setIsFetching(false);
              queryClient.invalidateQueries({ queryKey: ['catalog-cache-summary'] });
              queryClient.invalidateQueries({ queryKey: ['catalog-cache-list'] });
            }
          }
        }
      } catch (e) {
        // ignore polling errors
      }
    }, 5_000);
    
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isFetching, quantity, queryClient]);

  const startFetch = async () => {
    setIsFetching(true);
    setFetchProgress({
      status: 'running',
      message: `Fetching ${category || 'all categories'} from ${provider === 'rainforest' ? 'Amazon' : 'eBay'}...`,
      itemsFetched: 0,
      target: quantity,
      newUnique: 0,
      duplicates: 0,
    });

    try {
      const result = await postAction('run-builder', {
        provider,
        category_key: category || undefined,
        max_items_target: quantity,
      });
      
      // If the worker returned immediately with results
      const workerResult = result?.worker_result;
      if (workerResult?.items_upserted !== undefined) {
        setFetchProgress({
          status: 'done',
          message: `Fetched ${workerResult.items_upserted} items from ${provider === 'rainforest' ? 'Amazon' : 'eBay'}`,
          itemsFetched: workerResult.items_upserted ?? 0,
          target: quantity,
          newUnique: workerResult.new_unique_items ?? 0,
          duplicates: workerResult.duplicates_skipped ?? 0,
        });
        setIsFetching(false);
        queryClient.invalidateQueries({ queryKey: ['catalog-cache-summary'] });
        queryClient.invalidateQueries({ queryKey: ['catalog-cache-list'] });
      } else if (workerResult?.status === 'no_sources' || workerResult?.status === 'no_active_sources') {
        setFetchProgress({
          status: 'error',
          message: 'No builder sources configured for this category/provider. Add sources in builder settings.',
          itemsFetched: 0, target: quantity, newUnique: 0, duplicates: 0,
        });
        setIsFetching(false);
      } else if (workerResult?.status === 'paused') {
        setFetchProgress({
          status: 'error',
          message: 'Builder is currently paused. Resume it from settings.',
          itemsFetched: 0, target: quantity, newUnique: 0, duplicates: 0,
        });
        setIsFetching(false);
      }
    } catch (err: any) {
      setFetchProgress({
        status: 'error',
        message: err.message || 'Failed to start fetch',
        itemsFetched: 0,
        target: quantity,
        newUnique: 0,
        duplicates: 0,
      });
      setIsFetching(false);
    }
  };

  const startCampaignMut = useMutation({
    mutationFn: (form: typeof campaignForm) => postAction('start-campaign', form),
    onSuccess: () => {
      toast.success('Campaign started!');
      setCampaignOpen(false);
      queryClient.invalidateQueries({ queryKey: ['builder-status'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to start campaign'),
  });

  const cancelCampaignMut = useMutation({
    mutationFn: () => postAction('cancel-campaign', {}),
    onSuccess: () => {
      toast.success('Campaign canceled');
      queryClient.invalidateQueries({ queryKey: ['builder-status'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to cancel'),
  });

  const campaign = status?.campaign;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4" /> Fetch Products
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Controls Row */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={category || '_all'} onValueChange={(v) => setCategory(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 w-44 text-xs">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All categories</SelectItem>
                  {ALL_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="h-9 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ebay">eBay</SelectItem>
                  <SelectItem value="rainforest">Amazon</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Quantity</Label>
              <Input
                type="number"
                className="h-9 w-28 text-xs"
                value={quantity}
                min={10}
                max={10000}
                onChange={(e) => setQuantity(Math.max(10, Math.min(10000, +e.target.value)))}
              />
            </div>

            <Button
              onClick={startFetch}
              disabled={isFetching || (provider === 'ebay' && !ebayHealthy) || (provider === 'rainforest' && !amazonHealthy)}
              className="gap-2"
            >
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start Fetching
            </Button>

            <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-2">
                  <Timer className="h-3.5 w-3.5" /> Automate Window Run
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Start Campaign Window</DialogTitle>
                  <DialogDescription>
                    Set goals and timeframe for automated catalog building. The builder will run every 10 minutes until goals are met.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Window (days)</Label>
                      <Input type="number" value={campaignForm.run_window_days} onChange={(e) => setCampaignForm(f => ({ ...f, run_window_days: +e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Total Goal</Label>
                      <Input type="number" value={campaignForm.goal_total_items} onChange={(e) => setCampaignForm(f => ({ ...f, goal_total_items: +e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">eBay Goal</Label>
                      <Input type="number" value={campaignForm.goal_ebay_items} onChange={(e) => setCampaignForm(f => ({ ...f, goal_ebay_items: +e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Amazon Goal</Label>
                      <Input type="number" value={campaignForm.goal_amazon_items} onChange={(e) => setCampaignForm(f => ({ ...f, goal_amazon_items: +e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={campaignForm.continuous} onCheckedChange={(v) => setCampaignForm(f => ({ ...f, continuous: v }))} />
                    <Label className="text-xs">Continuous mode (keep going past goal)</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => startCampaignMut.mutate(campaignForm)} disabled={startCampaignMut.isPending}>Start Campaign</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Progress Panel */}
          {fetchProgress && (
            <Card className={`border ${
              fetchProgress.status === 'done' ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20' : 
              fetchProgress.status === 'error' ? 'border-destructive/50 bg-destructive/5' : 
              'border-primary/30'
            }`}>
              <CardContent className="py-3 px-4 space-y-2">
                <div className="flex items-center gap-2">
                  {fetchProgress.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {fetchProgress.status === 'done' && <CheckCircle className="h-4 w-4 text-green-600" />}
                  {fetchProgress.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="text-sm font-medium">{fetchProgress.message}</span>
                </div>
                
                {fetchProgress.status === 'running' && (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>{fetchProgress.itemsFetched} / {fetchProgress.target} items</span>
                    </div>
                    <Progress value={fetchProgress.target ? (fetchProgress.itemsFetched / fetchProgress.target) * 100 : 0} className="h-2" />
                  </div>
                )}

                {fetchProgress.status === 'done' && (
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>New unique: <span className="font-mono text-green-600">{fetchProgress.newUnique}</span></span>
                    <span>Duplicates: <span className="font-mono">{fetchProgress.duplicates}</span></span>
                    <span>Total fetched: <span className="font-mono font-semibold">{fetchProgress.itemsFetched}</span></span>
                  </div>
                )}

                {fetchProgress.status === 'done' && (
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setFetchProgress(null)}>
                    Dismiss
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Provider Health */}
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1">
              <Activity className={`h-3 w-3 ${ebayHealthy ? 'text-green-500' : 'text-destructive'}`} />
              eBay: {ebayHealthy ? 'Healthy' : healthMap.ebay?.reason || 'Unhealthy'}
            </span>
            <span className="flex items-center gap-1">
              <Activity className={`h-3 w-3 ${amazonHealthy ? 'text-green-500' : 'text-destructive'}`} />
              Amazon: {amazonHealthy ? 'Healthy' : healthMap.rainforest?.reason || 'Down'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Campaign Progress */}
      {campaign && campaign.status === 'running' && (
        <Card className="border-primary/30">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Campaign Progress
              </CardTitle>
              <Button size="sm" variant="destructive" onClick={() => cancelCampaignMut.mutate()} disabled={cancelCampaignMut.isPending} className="gap-1 h-7">
                <StopCircle className="h-3 w-3" /> Cancel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Total', achieved: campaign.achieved_total ?? 0, goal: campaign.goal_total ?? 0 },
                { label: 'eBay', achieved: campaign.achieved_ebay ?? 0, goal: campaign.goal_ebay ?? 0 },
                { label: 'Amazon', achieved: campaign.achieved_rainforest ?? 0, goal: campaign.goal_rainforest ?? 0 },
              ].map(({ label, achieved, goal }) => (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{label}</span>
                    <span>{achieved.toLocaleString()} / {goal.toLocaleString()}</span>
                  </div>
                  <Progress value={goal ? (achieved / goal) * 100 : 0} />
                </div>
              ))}
            </div>
            {campaign.end_at && (
              <p className="text-xs text-muted-foreground">
                ⏱ Window ends: {new Date(campaign.end_at).toLocaleDateString()} ({Math.max(0, Math.ceil((new Date(campaign.end_at).getTime() - Date.now()) / 86400000))}d remaining)
                {campaign.continuous && <Badge variant="outline" className="ml-2 text-[9px]">Continuous</Badge>}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Search Insights Panel ───────────────────────────────────────────────────
function SearchInsights() {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['search-insights'],
    queryFn: () => invokeAdmin({ mode: 'search-insights' }),
    staleTime: 120_000,
    enabled: open,
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Search Insights
              <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 space-y-4">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase">Top Searched Queries</h4>
                  <div className="space-y-1.5">
                    {(data?.top_queries ?? []).slice(0, 15).map((q: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs border-b border-border/50 pb-1">
                        <span className="truncate max-w-[180px]">{q.q_norm}</span>
                        <div className="flex gap-3 text-muted-foreground shrink-0">
                          <span>{q.search_count}×</span>
                          <span>DB:{q.avg_db ?? 0}</span>
                          <span>Live:{q.avg_live ?? 0}</span>
                        </div>
                      </div>
                    ))}
                    {(!data?.top_queries || data.top_queries.length === 0) && (
                      <p className="text-xs text-muted-foreground">No query data yet</p>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase">Most Popular Products</h4>
                  <div className="space-y-1.5">
                    {(data?.popular_products ?? []).slice(0, 15).map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs border-b border-border/50 pb-1">
                        {p.image_url && <img src={p.image_url} alt="" className="w-6 h-6 rounded object-cover" />}
                        <span className="truncate flex-1">{p.title || '—'}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{p.provider}</Badge>
                        <span className="text-muted-foreground shrink-0 flex items-center gap-0.5">
                          <Heart className="h-2.5 w-2.5" /> {p.popularity_score ?? 0}
                        </span>
                      </div>
                    ))}
                    {(!data?.popular_products || data.popular_products.length === 0) && (
                      <p className="text-xs text-muted-foreground">No popularity data yet</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Items Table ──────────────────────────────────────────────────────────────
function ItemsTable({ totalCount }: { totalCount: number }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<{ cursor: string | null; cursorId: string | null }>>([]);

  const applyFilters = useCallback(() => {
    setAppliedFilters({ ...filters });
    setCursor(null);
    setCursorId(null);
    setCursorStack([]);
  }, [filters]);

  const resetFilters = useCallback(() => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setCursor(null);
    setCursorId(null);
    setCursorStack([]);
  }, []);

  const buildParams = useCallback((): Record<string, string> => {
    const p: Record<string, string> = { mode: 'list', limit: String(PAGE_SIZE) };
    if (cursor) p.cursor = cursor;
    if (cursorId) p.cursor_id = cursorId;
    if (appliedFilters.category_key) p.category_key = appliedFilters.category_key;
    if (appliedFilters.provider) p.provider = appliedFilters.provider;
    if (appliedFilters.is_active) p.is_active = appliedFilters.is_active;
    if (appliedFilters.q) p.q = appliedFilters.q;
    if (appliedFilters.stale_price_days) p.stale_price_days = appliedFilters.stale_price_days;
    if (appliedFilters.not_seen_days) p.not_seen_days = appliedFilters.not_seen_days;
    if (appliedFilters.sort_by) p.sort_by = appliedFilters.sort_by;
    if (appliedFilters.date_preset) p.date_preset = appliedFilters.date_preset;
    return p;
  }, [cursor, cursorId, appliedFilters]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['catalog-cache-list', appliedFilters, cursor, cursorId],
    queryFn: () => invokeAdmin(buildParams()),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const items = data?.items ?? [];
  const hasMore = data?.has_more ?? false;
  const pageNum = cursorStack.length + 1;

  const goNext = useCallback(() => {
    if (data?.next_cursor) {
      setCursorStack(s => [...s, { cursor, cursorId }]);
      setCursor(data.next_cursor);
      setCursorId(data.next_cursor_id);
    }
  }, [data, cursor, cursorId]);

  const goPrev = useCallback(() => {
    if (cursorStack.length > 0) {
      const prev = cursorStack[cursorStack.length - 1];
      setCursorStack(s => s.slice(0, -1));
      setCursor(prev.cursor);
      setCursorId(prev.cursorId);
    }
  }, [cursorStack]);

  const actionMutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) => postAction(action, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-cache-list'] });
      queryClient.invalidateQueries({ queryKey: ['catalog-cache-summary'] });
      toast.success('Action completed');
    },
    onError: (err: any) => toast.error(err.message || 'Action failed'),
  });

  const handleDeactivate = (item: any) => actionMutation.mutate({ action: 'deactivate', body: { id: item.id } });
  const handleReactivate = (item: any) => actionMutation.mutate({ action: 'reactivate', body: { id: item.id } });
  const handleForceRefresh = (item: any) => actionMutation.mutate({
    action: 'force_refresh',
    body: { category_key: item.category_key || item.unified_category, provider: item.provider, query: item.title?.slice(0, 80) },
  });

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const date = new Date(d);
    const now = Date.now();
    const diffH = Math.round((now - date.getTime()) / 3600000);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.round(diffH / 24)}d ago`;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cached Products</h2>
        <span className="text-sm text-muted-foreground font-mono">~{totalCount.toLocaleString()} total</span>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Select value={filters.category_key || '_all'} onValueChange={(v) => setFilters((f) => ({ ...f, category_key: v === '_all' ? '' : v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Categories</SelectItem>
                {ALL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.provider || '_all'} onValueChange={(v) => setFilters((f) => ({ ...f, provider: v === '_all' ? '' : v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Provider" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Providers</SelectItem>
                <SelectItem value="amazon">Amazon</SelectItem>
                <SelectItem value="ebay">eBay</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.is_active || '_all'} onValueChange={(v) => setFilters((f) => ({ ...f, is_active: v === '_all' ? '' : v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.sort_by || '_default'} onValueChange={(v) => setFilters((f) => ({ ...f, sort_by: v === '_default' ? '' : v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Sort by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">Default</SelectItem>
                <SelectItem value="newest">Newest Added</SelectItem>
                <SelectItem value="recently_seen">Recently Seen</SelectItem>
                <SelectItem value="highest_price">Highest Price</SelectItem>
                <SelectItem value="popularity">Most Popular</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.date_preset || '_all'} onValueChange={(v) => setFilters((f) => ({ ...f, date_preset: v === '_all' ? '' : v }))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Date Added" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Time</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Search title…" className="h-9 text-xs" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
            <Input placeholder="Stale price (days)" type="number" className="h-9 text-xs" value={filters.stale_price_days} onChange={(e) => setFilters((f) => ({ ...f, stale_price_days: e.target.value }))} />
            <Input placeholder="Not seen (days)" type="number" className="h-9 text-xs" value={filters.not_seen_days} onChange={(e) => setFilters((f) => ({ ...f, not_seen_days: e.target.value }))} />
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={applyFilters} className="gap-1"><Search className="h-3.5 w-3.5" /> Apply</Button>
            <Button size="sm" variant="outline" onClick={resetFilters} className="gap-1"><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
            {isFetching && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground self-center ml-2" />}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-24">Category</TableHead>
                  <TableHead className="w-16">Provider</TableHead>
                  <TableHead className="w-20 text-right">Price</TableHead>
                  <TableHead className="w-16">Stock</TableHead>
                  <TableHead className="w-20">Added</TableHead>
                  <TableHead className="w-20">Seen</TableHead>
                  <TableHead className="w-20">Price ↻</TableHead>
                  <TableHead className="w-12">Fails</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 12 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : items.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No items found</TableCell>
                    </TableRow>
                  )
                  : items.map((item: any) => (
                    <TableRow key={item.id} className={!item.is_active ? 'opacity-60' : ''}>
                      <TableCell className="p-2">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="w-10 h-10 object-cover rounded" loading="lazy" />
                        ) : (
                          <div className="w-10 h-10 bg-muted rounded" />
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <a href={item.product_url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline line-clamp-2 flex items-start gap-1">
                          <span className="line-clamp-2">{item.title || '—'}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                        </a>
                      </TableCell>
                      <TableCell className="text-xs">{item.category_key || item.unified_category || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{item.provider}</Badge></TableCell>
                      <TableCell className="text-right text-xs font-mono">{item.price_usd != null ? `$${Number(item.price_usd).toFixed(2)}` : '—'}</TableCell>
                      <TableCell><Badge variant={item.in_stock ? 'default' : 'secondary'} className="text-[10px]">{item.in_stock ? 'Yes' : 'No'}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(item.first_seen_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(item.last_seen_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(item.price_updated_at)}</TableCell>
                      <TableCell className="text-xs text-center">{item.fail_count > 0 ? <Badge variant="destructive" className="text-[10px]">{item.fail_count}</Badge> : '0'}</TableCell>
                      <TableCell><Badge variant={item.is_active ? 'default' : 'secondary'} className="text-[10px]">{item.status_reason || (item.is_active ? 'active' : 'inactive')}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {item.is_active ? (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => handleDeactivate(item)} disabled={actionMutation.isPending}><PowerOff className="h-3 w-3" /></Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => handleReactivate(item)} disabled={actionMutation.isPending}><Power className="h-3 w-3" /></Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => handleForceRefresh(item)} disabled={actionMutation.isPending}><RefreshCw className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Footer with total and page */}
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">
              Showing {items.length} of ~{totalCount.toLocaleString()} items
              {' · '}Page {pageNum}
            </p>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={cursorStack.length === 0} onClick={goPrev}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={!hasMore} onClick={goNext}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Builder Sources (collapsible, advanced) ─────────────────────────────────
function BuilderSources() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newSource, setNewSource] = useState({
    category_key: '',
    provider: 'ebay',
    source_type: 'seed_query',
    source_value: '',
    priority: 10,
  });

  const { data: sources, isLoading } = useQuery({
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
    enabled: open,
  });

  const addSourceMutation = useMutation({
    mutationFn: async (source: typeof newSource) => {
      const { error } = await supabase.from('catalog_builder_sources' as any).insert(source);
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
      const { error } = await supabase.from('catalog_builder_sources' as any).update({ enabled }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog-builder-sources'] }),
  });

  const resetProgressMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await supabase.from('catalog_builder_state' as any).upsert({
        source_id: sourceId, current_offset: 0, total_ingested: 0, exhausted: false, last_run_at: null, last_error: null,
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Plus className="h-4 w-4" /> Builder Sources ({sources?.length ?? '…'})
              <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 space-y-4">
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
              <Input placeholder="Query or Category ID" className="h-9 text-xs" value={newSource.source_value} onChange={(e) => setNewSource(s => ({ ...s, source_value: e.target.value }))} />
              <Button size="sm" onClick={() => newSource.category_key && newSource.source_value && addSourceMutation.mutate(newSource)} disabled={!newSource.category_key || !newSource.source_value || addSourceMutation.isPending}>
                {addSourceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
              </Button>
            </div>
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
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 10 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                    ))
                  ) : !sources?.length ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground text-xs">No sources configured</TableCell></TableRow>
                  ) : (
                    sources.map((src: any) => {
                      const state = src.catalog_builder_state?.[0];
                      return (
                        <TableRow key={src.id} className={!src.enabled ? 'opacity-50' : ''}>
                          <TableCell><Switch checked={src.enabled} onCheckedChange={(v) => toggleSourceMutation.mutate({ id: src.id, enabled: v })} /></TableCell>
                          <TableCell className="text-xs">{src.category_key}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{src.provider}</Badge></TableCell>
                          <TableCell className="text-xs">{src.source_type}</TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">{src.source_value}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{state?.current_offset || 0}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{state?.total_ingested || 0}</TableCell>
                          <TableCell>{state?.exhausted ? <Badge variant="secondary" className="text-[10px]">Exhausted</Badge> : <Badge variant="default" className="text-[10px]">Active</Badge>}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(state?.last_run_at)}</TableCell>
                          <TableCell><Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => resetProgressMutation.mutate(src.id)} disabled={resetProgressMutation.isPending} title="Reset progress"><RotateCcw className="h-3 w-3" /></Button></TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Recent Fetch History ────────────────────────────────────────────────────
function RecentFetchHistory() {
  const [open, setOpen] = useState(false);

  const { data: runs, isLoading } = useQuery({
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
    enabled: open,
  });

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" /> Recent Fetch History
              <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
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
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                    ))
                  ) : !runs?.length ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground text-xs">No fetch history yet</TableCell></TableRow>
                  ) : (
                    runs.map((run: any) => (
                      <TableRow key={run.id}>
                        <TableCell><Badge variant="outline" className="text-[10px]">{run.provider}</Badge></TableCell>
                        <TableCell className="text-xs">{fmtDate(run.started_at)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{run.items_upserted}</TableCell>
                        <TableCell className="text-right text-xs font-mono text-green-600">{run.new_unique_items}</TableCell>
                        <TableCell className="text-right text-xs font-mono text-muted-foreground">{run.duplicates_skipped}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{run.rate_limited_count > 0 ? <Badge variant="destructive" className="text-[10px]">{run.rate_limited_count}</Badge> : '0'}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{run.sources_processed}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{(run.duration_ms / 1000).toFixed(1)}s</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function CatalogCache() {
  const { language } = useLanguage();
  const [totalCount, setTotalCount] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {language === 'fr' ? 'Cache Catalogue' : 'Catalog Cache'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'fr'
            ? 'Parcourir et gérer les articles du catalogue mis en cache'
            : 'Browse and manage cached catalog items'}
        </p>
      </div>

      <SummaryCards onTotalCount={setTotalCount} />
      <FetchProducts />
      <SearchInsights />
      <ItemsTable totalCount={totalCount} />
      <RecentFetchHistory />
      <BuilderSources />
    </div>
  );
}
