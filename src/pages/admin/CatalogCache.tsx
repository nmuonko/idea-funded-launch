import { useState, useCallback } from 'react';
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
  StopCircle, ArrowUpDown
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
function SummaryCards() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog-cache-summary'],
    queryFn: () => invokeAdmin({ mode: 'summary' }),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const cards = [
    { label: 'Total', value: data?.total_count ?? 0, icon: Database, color: 'text-foreground' },
    { label: 'Active', value: data?.active_count ?? 0, icon: Package, color: 'text-green-600' },
    { label: 'Inactive', value: data?.inactive_count ?? 0, icon: PowerOff, color: 'text-muted-foreground' },
    { label: 'Dead (≥3 fails)', value: data?.dead_count ?? 0, icon: XCircle, color: 'text-destructive' },
    { label: 'Stale Price', value: data?.stale_price_count ?? 0, icon: Clock, color: 'text-orange-500' },
    { label: 'Thin (<2k)', value: data?.thin_categories?.length ?? 0, icon: AlertTriangle, color: 'text-yellow-600' },
  ];

  return (
    <>
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

      {data?.thin_categories?.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Thin Categories (&lt;2,000 active)</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-2">
              {data.thin_categories.map((c: any) => (
                <Badge key={c.category_key} variant="outline" className="text-xs">
                  {c.category_key}: {c.active_count.toLocaleString()}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ── Run Control Buttons ─────────────────────────────────────────────────────
function RunControls() {
  const queryClient = useQueryClient();
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    run_window_days: 7,
    goal_total_items: 10000,
    goal_ebay_items: 5000,
    goal_amazon_items: 5000,
    continuous: true,
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['builder-status'],
    queryFn: () => invokeAdmin({ mode: 'builder-status' }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const runBuilderMut = useMutation({
    mutationFn: (provider: string) => postAction('run-builder', { provider }),
    onSuccess: (data) => {
      toast.success(`Builder run started for ${data?.provider || 'provider'}`);
      queryClient.invalidateQueries({ queryKey: ['builder-status'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to start builder'),
  });

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
  const health = status?.provider_health;
  const ebayHealthy = !health?.ebay || health.ebay.healthy !== false;
  const amazonHealthy = !health?.rainforest || health.rainforest.healthy !== false;

  return (
    <div className="space-y-4">
      {/* Run Buttons */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4" /> Builder Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex flex-wrap gap-3">
            <Button
              size="sm"
              onClick={() => runBuilderMut.mutate('ebay')}
              disabled={runBuilderMut.isPending}
              className="gap-2"
            >
              <Play className="h-3.5 w-3.5" /> Run eBay Builder Now
              {!ebayHealthy && <Badge variant="destructive" className="text-[9px] ml-1">Unhealthy</Badge>}
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => runBuilderMut.mutate('rainforest')}
              disabled={runBuilderMut.isPending || !amazonHealthy}
              className="gap-2"
            >
              <Play className="h-3.5 w-3.5" /> Run Amazon Builder Now
              {!amazonHealthy && <Badge variant="destructive" className="text-[9px] ml-1">Down</Badge>}
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
                    Set goals and timeframe for automated catalog building. The builder will run every 10 minutes until goals are met or the window expires.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Window (days)</Label>
                      <Input
                        type="number"
                        value={campaignForm.run_window_days}
                        onChange={(e) => setCampaignForm(f => ({ ...f, run_window_days: +e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Total Goal</Label>
                      <Input
                        type="number"
                        value={campaignForm.goal_total_items}
                        onChange={(e) => setCampaignForm(f => ({ ...f, goal_total_items: +e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">eBay Goal</Label>
                      <Input
                        type="number"
                        value={campaignForm.goal_ebay_items}
                        onChange={(e) => setCampaignForm(f => ({ ...f, goal_ebay_items: +e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Amazon Goal</Label>
                      <Input
                        type="number"
                        value={campaignForm.goal_amazon_items}
                        onChange={(e) => setCampaignForm(f => ({ ...f, goal_amazon_items: +e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={campaignForm.continuous}
                      onCheckedChange={(v) => setCampaignForm(f => ({ ...f, continuous: v }))}
                    />
                    <Label className="text-xs">Continuous mode (keep going past goal)</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => startCampaignMut.mutate(campaignForm)}
                    disabled={startCampaignMut.isPending}
                  >
                    Start Campaign
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Provider Health */}
          {health && (
            <div className="flex gap-4 mt-3 text-xs">
              <span className="flex items-center gap-1">
                <Activity className={`h-3 w-3 ${ebayHealthy ? 'text-green-500' : 'text-destructive'}`} />
                eBay: {ebayHealthy ? 'Healthy' : health.ebay?.reason || 'Unhealthy'}
              </span>
              <span className="flex items-center gap-1">
                <Activity className={`h-3 w-3 ${amazonHealthy ? 'text-green-500' : 'text-destructive'}`} />
                Amazon: {amazonHealthy ? 'Healthy' : health.rainforest?.reason || 'Down'}
              </span>
            </div>
          )}
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
              <Button
                size="sm"
                variant="destructive"
                onClick={() => cancelCampaignMut.mutate()}
                disabled={cancelCampaignMut.isPending}
                className="gap-1 h-7"
              >
                <StopCircle className="h-3 w-3" /> Cancel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Total</span>
                  <span>{(campaign.achieved_total ?? 0).toLocaleString()} / {(campaign.goal_total ?? 0).toLocaleString()}</span>
                </div>
                <Progress value={campaign.goal_total ? (campaign.achieved_total / campaign.goal_total) * 100 : 0} />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>eBay</span>
                  <span>{(campaign.achieved_ebay ?? 0).toLocaleString()} / {(campaign.goal_ebay ?? 0).toLocaleString()}</span>
                </div>
                <Progress value={campaign.goal_ebay ? (campaign.achieved_ebay / campaign.goal_ebay) * 100 : 0} />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Amazon</span>
                  <span>{(campaign.achieved_rainforest ?? 0).toLocaleString()} / {(campaign.goal_rainforest ?? 0).toLocaleString()}</span>
                </div>
                <Progress value={campaign.goal_rainforest ? (campaign.achieved_rainforest / campaign.goal_rainforest) * 100 : 0} />
              </div>
            </div>
            {campaign.end_at && (
              <p className="text-xs text-muted-foreground">
                ⏱ Window ends: {new Date(campaign.end_at).toLocaleDateString()} ({
                  Math.max(0, Math.ceil((new Date(campaign.end_at).getTime() - Date.now()) / 86400000))
                }d remaining)
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
                {/* Top Queries */}
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

                {/* Popular Products */}
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
function ItemsTable() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(0);

  const applyFilters = useCallback(() => {
    setAppliedFilters({ ...filters });
    setPage(0);
  }, [filters]);

  const resetFilters = useCallback(() => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setPage(0);
  }, []);

  const buildParams = useCallback((): Record<string, string> => {
    const p: Record<string, string> = {
      mode: 'list',
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    };
    if (appliedFilters.category_key) p.category_key = appliedFilters.category_key;
    if (appliedFilters.provider) p.provider = appliedFilters.provider;
    if (appliedFilters.is_active) p.is_active = appliedFilters.is_active;
    if (appliedFilters.q) p.q = appliedFilters.q;
    if (appliedFilters.stale_price_days) p.stale_price_days = appliedFilters.stale_price_days;
    if (appliedFilters.not_seen_days) p.not_seen_days = appliedFilters.not_seen_days;
    if (appliedFilters.sort_by) p.sort_by = appliedFilters.sort_by;
    if (appliedFilters.date_preset) p.date_preset = appliedFilters.date_preset;
    return p;
  }, [page, appliedFilters]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['catalog-cache-list', appliedFilters, page],
    queryFn: () => invokeAdmin(buildParams()),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const items = data?.items ?? [];
  const totalCount = data?.total_count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const actionMutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) =>
      postAction(action, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-cache-list'] });
      queryClient.invalidateQueries({ queryKey: ['catalog-cache-summary'] });
      toast.success('Action completed');
    },
    onError: (err: any) => toast.error(err.message || 'Action failed'),
  });

  const handleDeactivate = (item: any) =>
    actionMutation.mutate({ action: 'deactivate', body: { id: item.id } });
  const handleReactivate = (item: any) =>
    actionMutation.mutate({ action: 'reactivate', body: { id: item.id } });
  const handleForceRefresh = (item: any) =>
    actionMutation.mutate({
      action: 'force_refresh',
      body: {
        category_key: item.category_key || item.unified_category,
        provider: item.provider,
        query: item.title?.slice(0, 80),
      },
    });

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const date = new Date(d);
    const now = Date.now();
    const diffH = Math.round((now - date.getTime()) / 3600000);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d ago`;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Select
              value={filters.category_key || '_all'}
              onValueChange={(v) => setFilters((f) => ({ ...f, category_key: v === '_all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Categories</SelectItem>
                {ALL_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.provider || '_all'}
              onValueChange={(v) => setFilters((f) => ({ ...f, provider: v === '_all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Providers</SelectItem>
                <SelectItem value="amazon">Amazon</SelectItem>
                <SelectItem value="ebay">eBay</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.is_active || '_all'}
              onValueChange={(v) => setFilters((f) => ({ ...f, is_active: v === '_all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.sort_by || '_default'}
              onValueChange={(v) => setFilters((f) => ({ ...f, sort_by: v === '_default' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">Default</SelectItem>
                <SelectItem value="newest">Newest Added</SelectItem>
                <SelectItem value="recently_seen">Recently Seen</SelectItem>
                <SelectItem value="highest_price">Highest Price</SelectItem>
                <SelectItem value="popularity">Most Popular</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.date_preset || '_all'}
              onValueChange={(v) => setFilters((f) => ({ ...f, date_preset: v === '_all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Date Added" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Time</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Search title…"
              className="h-9 text-xs"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />

            <Input
              placeholder="Stale price (days)"
              type="number"
              className="h-9 text-xs"
              value={filters.stale_price_days}
              onChange={(e) => setFilters((f) => ({ ...f, stale_price_days: e.target.value }))}
            />

            <Input
              placeholder="Not seen (days)"
              type="number"
              className="h-9 text-xs"
              value={filters.not_seen_days}
              onChange={(e) => setFilters((f) => ({ ...f, not_seen_days: e.target.value }))}
            />
          </div>

          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={applyFilters} className="gap-1">
              <Search className="h-3.5 w-3.5" /> Apply
            </Button>
            <Button size="sm" variant="outline" onClick={resetFilters} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
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
                      <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                        No items found
                      </TableCell>
                    </TableRow>
                  )
                  : items.map((item: any) => (
                    <TableRow key={item.id} className={!item.is_active ? 'opacity-60' : ''}>
                      <TableCell className="p-2">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            className="w-10 h-10 object-cover rounded"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-muted rounded" />
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <a
                          href={item.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs hover:underline line-clamp-2 flex items-start gap-1"
                        >
                          <span className="line-clamp-2">{item.title || '—'}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                        </a>
                      </TableCell>
                      <TableCell className="text-xs">{item.category_key || item.unified_category || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{item.provider}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {item.price_usd != null ? `$${Number(item.price_usd).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.in_stock ? 'default' : 'secondary'} className="text-[10px]">
                          {item.in_stock ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(item.first_seen_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(item.last_seen_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(item.price_updated_at)}</TableCell>
                      <TableCell className="text-xs text-center">
                        {item.fail_count > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">{item.fail_count}</Badge>
                        ) : '0'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={item.is_active ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {item.status_reason || (item.is_active ? 'active' : 'inactive')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {item.is_active ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[10px]"
                              onClick={() => handleDeactivate(item)}
                              disabled={actionMutation.isPending}
                            >
                              <PowerOff className="h-3 w-3" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[10px]"
                              onClick={() => handleReactivate(item)}
                              disabled={actionMutation.isPending}
                            >
                              <Power className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[10px]"
                            onClick={() => handleForceRefresh(item)}
                            disabled={actionMutation.isPending}
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">
              {totalCount.toLocaleString()} items · Page {page + 1} of {Math.max(1, totalPages)}
            </p>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function CatalogCache() {
  const { language } = useLanguage();

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

      <SummaryCards />
      <RunControls />
      <SearchInsights />
      <ItemsTable />
    </div>
  );
}
