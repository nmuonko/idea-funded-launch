import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2 } from 'lucide-react';
import { ShopFooter } from '@/components/shop/ShopFooter';

interface VipProduct {
  id: string;
  name_fr: string | null;
  description_fr: string | null;
  image_url: string;
  final_price: number | null;
  status: 'available' | 'unavailable';
  category_id: string | null;
  colors: string[];
  sizes: string[];
}

interface VipCategory {
  id: string;
  name: string;
  name_fr: string | null;
}

export default function VipStorefront() {
  const [products, setProducts] = useState<VipProduct[]>([]);
  const [categories, setCategories] = useState<VipCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [sort, setSort] = useState('newest');

  useEffect(() => {
    (async () => {
      const [{ data: prods }, { data: cats }] = await Promise.all([
        supabase
          .from('vip_products')
          .select('id, name_fr, description_fr, image_url, final_price, status, category_id, colors, sizes')
          .in('status', ['available', 'unavailable'])
          .order('published_at', { ascending: false })
          .limit(300),
        supabase.from('vip_categories').select('id, name, name_fr').eq('is_active', true).order('name'),
      ]);
      setProducts((prods as VipProduct[]) ?? []);
      setCategories((cats as VipCategory[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = products;
    if (categoryId !== 'all') list = list.filter((p) => p.category_id === categoryId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        (p.name_fr ?? '').toLowerCase().includes(q) ||
        (p.description_fr ?? '').toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sort === 'price_asc') sorted.sort((a, b) => (a.final_price ?? 0) - (b.final_price ?? 0));
    if (sort === 'price_desc') sorted.sort((a, b) => (b.final_price ?? 0) - (a.final_price ?? 0));
    if (sort === 'name') sorted.sort((a, b) => (a.name_fr ?? '').localeCompare(b.name_fr ?? ''));
    return sorted;
  }, [products, categoryId, search, sort]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50/60 via-background to-background">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/vip" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight">AfriShop <span className="text-amber-600">VIP</span></span>
          </Link>
          <p className="text-sm text-muted-foreground hidden sm:block">Collection exclusive — prix final, tout inclus</p>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un article…" className="pl-8" />
          </div>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Catégorie" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les catégories</SelectItem>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name_fr || c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Trier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Nouveautés</SelectItem>
              <SelectItem value="price_asc">Prix croissant</SelectItem>
              <SelectItem value="price_desc">Prix décroissant</SelectItem>
              <SelectItem value="name">Nom A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <p className="text-lg font-medium">Aucun article pour le moment</p>
            <p className="text-sm">Revenez bientôt — la collection VIP est mise à jour régulièrement.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {filtered.map((p) => {
              const soldOut = p.status === 'unavailable';
              return (
                <Link
                  key={p.id}
                  to={`/vip/${p.id}`}
                  className="group rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                    <img
                      src={p.image_url}
                      alt={p.name_fr ?? ''}
                      loading="lazy"
                      className={`object-cover w-full h-full group-hover:scale-105 transition-transform duration-300 ${soldOut ? 'opacity-60' : ''}`}
                    />
                    {soldOut && (
                      <span className="absolute top-2 left-2 bg-amber-500 text-white text-xs font-semibold px-2 py-1 rounded-full">
                        Rupture de stock
                      </span>
                    )}
                  </div>
                  <div className="p-3 space-y-1">
                    <p className="font-medium text-sm leading-snug line-clamp-2">{p.name_fr}</p>
                    {p.colors.length > 0 && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{p.colors.join(', ')}</p>
                    )}
                    <p className="font-semibold text-amber-700 dark:text-amber-500">${p.final_price?.toFixed(2)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <ShopFooter />
    </div>
  );
}
