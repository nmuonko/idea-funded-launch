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
import { toast } from 'sonner';
import {
  Database, Package, AlertTriangle, XCircle, Clock, ChevronLeft, ChevronRight,
  RefreshCw, Power, PowerOff, Search, RotateCcw, ExternalLink
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
}

const defaultFilters: Filters = {
  category_key: '',
  provider: '',
  is_active: '',
  q: '',
  stale_price_days: '',
  not_seen_days: '',
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
                        {Array.from({ length: 11 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : items.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
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
      <ItemsTable />
    </div>
  );
}
