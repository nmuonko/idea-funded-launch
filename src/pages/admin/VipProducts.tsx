import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Search, Loader2, Trash2, EyeOff, Upload, Package, DollarSign, Layers, TrendingUp } from 'lucide-react';

interface VipProduct {
  id: string;
  batch_id: string | null;
  category_id: string | null;
  name_fr: string | null;
  description_fr: string | null;
  image_url: string;
  purchase_price: number | null;
  shipping_cost: number | null;
  shipping_buffer: number | null;
  profit: number | null;
  final_price: number | null;
  status: 'draft' | 'available' | 'unavailable' | 'hidden';
  colors: string[];
  sizes: string[];
  published_at: string | null;
  created_at: string;
  vip_categories?: { name: string; name_fr: string | null } | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  available: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  unavailable: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  hidden: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

export default function VipProducts() {
  const { toast } = useToast();
  const [products, setProducts] = useState<VipProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categories, setCategories] = useState<{ id: string; name: string; name_fr: string | null }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: prods }, { data: cats }] = await Promise.all([
      supabase.from('vip_products').select('*, vip_categories(name, name_fr)').order('created_at', { ascending: false }).limit(500),
      supabase.from('vip_categories').select('id, name, name_fr').order('name'),
    ]);
    setProducts((prods as VipProduct[]) ?? []);
    setCategories(cats ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => products.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && p.category_id !== categoryFilter) return false;
    if (search && !(p.name_fr ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [products, statusFilter, categoryFilter, search]);

  const stats = useMemo(() => {
    const published = products.filter((p) => p.status === 'available' || p.status === 'unavailable');
    const drafts = products.filter((p) => p.status === 'draft');
    const batches = new Set(products.map((p) => p.batch_id).filter(Boolean)).size;
    const totalProfit = products.reduce((s, p) => s + (p.profit ?? 0), 0);
    const avgProfit = products.length ? totalProfit / products.length : 0;
    return { total: products.length, published: published.length, drafts: drafts.length, batches, avgProfit, totalProfit };
  }, [products]);

  const bulkAction = async (action: string, ids: string[], extra: Record<string, unknown> = {}) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('vip-publish', {
        body: { action, product_ids: ids, ...extra },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message ?? data?.error ?? 'failed');
      toast({ title: 'Done' });
      setSelected(new Set());
      await load();
    } catch (e: any) {
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (ids: string[], status: string) =>
    bulkAction(status === 'available' ? 'publish' : 'set_status', ids, { status });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">VIP Products</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage every product created by the AI Clothing Importer.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total products', value: stats.total, icon: Package },
          { label: 'Published', value: stats.published, icon: Upload },
          { label: 'Drafts', value: stats.drafts, icon: EyeOff },
          { label: 'Batches', value: stats.batches, icon: Layers },
          { label: 'Est. profit / item', value: `$${stats.avgProfit.toFixed(2)}`, icon: DollarSign },
          { label: 'Est. inventory profit', value: `$${stats.totalProfit.toFixed(2)}`, icon: TrendingUp },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <s.icon className="h-4 w-4 text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Estimated profit is based on listing data only — it is not realized profit from paid orders.</p>

      {/* Filters + bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="pl-8" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
            <SelectItem value="hidden">Hidden</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name_fr || c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <div className="flex gap-1.5 ml-auto">
            <Button size="sm" disabled={busy} onClick={() => setStatus([...selected], 'available')}>Publish ({selected.size})</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus([...selected], 'unavailable')}>Mark unavailable</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus([...selected], 'hidden')}>Hide</Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => bulkAction('delete', [...selected])}><Trash2 className="h-4 w-4" /></Button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No VIP products yet — use the AI Clothing Importer to create your first batch.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <Checkbox
                checked={selected.has(p.id)}
                onCheckedChange={(v) => {
                  const next = new Set(selected);
                  if (v) next.add(p.id); else next.delete(p.id);
                  setSelected(next);
                }}
                aria-label={`Select ${p.name_fr ?? 'product'}`}
              />
              <img src={p.image_url} alt={p.name_fr ?? ''} className="w-14 h-14 rounded-md object-cover border" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.name_fr ?? '(no name)'}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {p.vip_categories?.name_fr || p.vip_categories?.name || 'No category'} · {new Date(p.created_at).toLocaleDateString()}
                  {p.published_at && ` · published ${new Date(p.published_at).toLocaleDateString()}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Buy ${p.purchase_price?.toFixed(2) ?? '—'} + ship ${p.shipping_cost?.toFixed(2) ?? '—'} + buffer ${p.shipping_buffer?.toFixed(2) ?? '—'} + profit ${p.profit?.toFixed(2) ?? '—'}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold">${p.final_price?.toFixed(2) ?? '—'}</p>
                <Badge className={STATUS_STYLES[p.status]}>{p.status}</Badge>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {p.status === 'draft' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus([p.id], 'available')}>Publish</Button>}
                {p.status === 'available' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus([p.id], 'unavailable')}>Sold out</Button>}
                {p.status === 'unavailable' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus([p.id], 'available')}>Restock</Button>}
                {p.status !== 'hidden' && p.status !== 'draft' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus([p.id], 'hidden')}>Hide</Button>}
                {p.status === 'hidden' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus([p.id], 'available')}>Restore</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
