import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Save } from 'lucide-react';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';

interface Category {
  id: string;
  name: string;
  name_fr: string | null;
  default_weight_kg: number;
  shipping_rate_per_kg: number | null;
  is_active: boolean;
}

interface Bracket {
  id: string;
  min_kg: number;
  max_kg: number;
  express_eur: number | null;
  standard_eur: number | null;
  is_active: boolean;
}

export default function VipPricing() {
  const { toast } = useToast();
  const { permissions } = useAdminPermissions();
  const isSuperAdmin = permissions?.isSuperAdmin ?? false;

  const [bufferPct, setBufferPct] = useState('10');
  const [markupPct, setMarkupPct] = useState('30');
  const [eurRate, setEurRate] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [newBracket, setNewBracket] = useState({ min: '', max: '', express: '', standard: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState({ name: '', name_fr: '', weight: '0.5', rate: '30' });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: settings }, { data: cats }, { data: brs }] = await Promise.all([
      supabase.from('vip_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('vip_categories').select('*').order('name'),
      supabase.from('vip_shipping_brackets').select('*').order('min_kg'),
    ]);
    if (settings) {
      setBufferPct(String(settings.shipping_buffer_percent));
      setMarkupPct(String(settings.profit_markup_percent));
      setEurRate(settings.eur_usd_rate != null ? String(settings.eur_usd_rate) : '');
    }
    setCategories((cats as Category[]) ?? []);
    setBrackets((brs as Bracket[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async () => {
    setSaving(true);
    const { error } = await supabase.from('vip_settings').update({
      shipping_buffer_percent: Number(bufferPct) || 10,
      profit_markup_percent: Number(markupPct) || 30,
      eur_usd_rate: Number(eurRate) > 0 ? Number(eurRate) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setSaving(false);
    if (error) {
      toast({ title: 'Could not save settings', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Settings saved — new batches will use these percentages. Existing published prices are unchanged.' });
    }
  };

  const saveCategory = async (c: Category) => {
    const { error } = await supabase.from('vip_categories').update({
      name: c.name,
      name_fr: c.name_fr,
      default_weight_kg: c.default_weight_kg,
      shipping_rate_per_kg: c.shipping_rate_per_kg,
      is_active: c.is_active,
      updated_at: new Date().toISOString(),
    }).eq('id', c.id);
    if (error) toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    else toast({ title: `"${c.name}" saved` });
  };

  const addCategory = async () => {
    const name = newCat.name.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Category already exists', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('vip_categories').insert({
      name,
      name_fr: newCat.name_fr.trim() || null,
      default_weight_kg: Number(newCat.weight) || 0.5,
      shipping_rate_per_kg: Number(newCat.rate) > 0 ? Number(newCat.rate) : null,
    });
    if (error) toast({ title: 'Could not create category', description: error.message, variant: 'destructive' });
    else {
      toast({ title: `Category "${name}" created` });
      setNewCat({ name: '', name_fr: '', weight: '0.5', rate: '30' });
      load();
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">VIP Pricing Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Control how VIP selling prices are calculated. Changes apply to new batches only — published prices never change silently.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Global percentages</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <Label>Shipping buffer (%)</Label>
              <Input type="number" min="0" step="1" value={bufferPct} onChange={(e) => setBufferPct(e.target.value)} disabled={!isSuperAdmin} />
            </div>
            <div>
              <Label>Profit markup (% of purchase price)</Label>
              <Input type="number" min="0" step="1" value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} disabled={!isSuperAdmin} />
            </div>
          </div>
          {!isSuperAdmin && <p className="text-xs text-muted-foreground">Only super admins can change these percentages.</p>}
          <Button onClick={saveSettings} disabled={saving || !isSuperAdmin}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />} Save settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Clothing categories & shipping rates</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {categories.map((c, i) => (
            <div key={c.id} className="grid grid-cols-[1fr_1fr_90px_100px_auto_auto] gap-2 items-center max-sm:grid-cols-2">
              <Input value={c.name} onChange={(e) => setCategories((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Category name" />
              <Input value={c.name_fr ?? ''} placeholder="French name" onChange={(e) => setCategories((prev) => prev.map((x, j) => (j === i ? { ...x, name_fr: e.target.value } : x)))} aria-label="French name" />
              <Input type="number" step="0.1" value={c.default_weight_kg} onChange={(e) => setCategories((prev) => prev.map((x, j) => (j === i ? { ...x, default_weight_kg: Number(e.target.value) } : x)))} aria-label="Weight kg" />
              <Input type="number" step="1" value={c.shipping_rate_per_kg ?? ''} placeholder="$/kg" onChange={(e) => setCategories((prev) => prev.map((x, j) => (j === i ? { ...x, shipping_rate_per_kg: e.target.value === '' ? null : Number(e.target.value) } : x)))} aria-label="Rate per kg" />
              <div className="flex items-center gap-1.5">
                <Switch checked={c.is_active} onCheckedChange={(v) => setCategories((prev) => prev.map((x, j) => (j === i ? { ...x, is_active: v } : x)))} aria-label="Active" />
                <span className="text-xs text-muted-foreground">{c.is_active ? 'Active' : 'Off'}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => saveCategory(c)}><Save className="h-3.5 w-3.5" /></Button>
            </div>
          ))}

          <div className="border-t pt-4 mt-4">
            <p className="text-sm font-medium mb-2">Add category</p>
            <div className="grid grid-cols-[1fr_1fr_90px_100px_auto] gap-2 items-center max-sm:grid-cols-2">
              <Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="Name (English)" />
              <Input value={newCat.name_fr} onChange={(e) => setNewCat({ ...newCat, name_fr: e.target.value })} placeholder="French name" />
              <Input type="number" step="0.1" value={newCat.weight} onChange={(e) => setNewCat({ ...newCat, weight: e.target.value })} placeholder="kg" />
              <Input type="number" step="1" value={newCat.rate} onChange={(e) => setNewCat({ ...newCat, rate: e.target.value })} placeholder="$/kg" />
              <Button size="sm" onClick={addCategory} disabled={!newCat.name.trim()}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
