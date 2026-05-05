import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { Trash2, ArrowUp, ArrowDown, Upload, Plus, Eye, MousePointerClick } from 'lucide-react';

interface Reel {
  id: string;
  title: string;
  caption: string | null;
  video_url: string;
  poster_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  product_provider: string | null;
  product_id: string | null;
  sort_order: number;
  is_active: boolean;
  views_count: number;
  clicks_count: number;
}

const empty = {
  title: '',
  caption: '',
  video_url: '',
  poster_url: '',
  cta_label: 'Shop now',
  cta_url: '',
  product_provider: '',
  product_id: '',
  is_active: true,
};

export default function AdminReels() {
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [uploading, setUploading] = useState(false);
  const [posterUploading, setPosterUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ad_reels')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) toast.error(error.message);
    else setReels((data as Reel[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const upload = async (file: File, kind: 'video' | 'poster') => {
    const ext = file.name.split('.').pop();
    const path = `${kind}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('reels').upload(path, file, { contentType: file.type });
    if (error) { toast.error(error.message); return null; }
    const { data } = supabase.storage.from('reels').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('Video must be under 50MB'); return; }
    setUploading(true);
    const url = await upload(file, 'video');
    setUploading(false);
    if (url) { setForm({ ...form, video_url: url }); toast.success('Video uploaded'); }
  };

  const handlePosterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPosterUploading(true);
    const url = await upload(file, 'poster');
    setPosterUploading(false);
    if (url) { setForm({ ...form, poster_url: url }); toast.success('Poster uploaded'); }
  };

  const create = async () => {
    if (!form.title || !form.video_url) { toast.error('Title and video are required'); return; }
    setSaving(true);
    const maxOrder = reels.reduce((m, r) => Math.max(m, r.sort_order), -1);
    const { error } = await supabase.from('ad_reels').insert({
      title: form.title,
      caption: form.caption || null,
      video_url: form.video_url,
      poster_url: form.poster_url || null,
      cta_label: form.cta_label || null,
      cta_url: form.cta_url || null,
      product_provider: form.product_provider || null,
      product_id: form.product_id || null,
      is_active: form.is_active,
      sort_order: maxOrder + 1,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success('Reel added'); setForm(empty); load(); }
  };

  const toggleActive = async (r: Reel) => {
    await supabase.from('ad_reels').update({ is_active: !r.is_active }).eq('id', r.id);
    load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const a = reels[idx]; const b = reels[idx + dir];
    if (!a || !b) return;
    await supabase.from('ad_reels').update({ sort_order: b.sort_order }).eq('id', a.id);
    await supabase.from('ad_reels').update({ sort_order: a.sort_order }).eq('id', b.id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this reel?')) return;
    await supabase.from('ad_reels').delete().eq('id', id);
    load();
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Reels (Video Ads)</h1>
        <p className="text-sm text-muted-foreground">Short vertical videos shown on the homepage. Tap opens fullscreen player.</p>
      </div>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> New Reel</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>CTA label</Label>
            <Input value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} placeholder="Shop now" />
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Caption</Label>
            <Textarea rows={2} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Video file (MP4, &lt;50MB) *</Label>
            <div className="flex items-center gap-2">
              <Input type="file" accept="video/mp4,video/webm" onChange={handleVideoUpload} disabled={uploading} />
              {uploading && <span className="text-xs">Uploading…</span>}
            </div>
            {form.video_url && <video src={form.video_url} className="h-32 rounded" controls muted />}
          </div>
          <div className="space-y-2">
            <Label>Poster image (optional)</Label>
            <div className="flex items-center gap-2">
              <Input type="file" accept="image/*" onChange={handlePosterUpload} disabled={posterUploading} />
              {posterUploading && <span className="text-xs">Uploading…</span>}
            </div>
            {form.poster_url && <img src={form.poster_url} alt="" className="h-32 rounded object-cover" />}
          </div>
          <div className="space-y-2">
            <Label>Linked product provider</Label>
            <Input value={form.product_provider} onChange={(e) => setForm({ ...form, product_provider: e.target.value })} placeholder="amazon / ebay" />
          </div>
          <div className="space-y-2">
            <Label>Linked product ID</Label>
            <Input value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} placeholder="ASIN or itemId" />
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>External CTA URL (used if no product linked)</Label>
            <Input value={form.cta_url} onChange={(e) => setForm({ ...form, cta_url: e.target.value })} placeholder="https://… or /path" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            <Label>Active</Label>
          </div>
        </div>
        <Button onClick={create} disabled={saving || uploading || !form.video_url || !form.title}>
          <Upload className="w-4 h-4 mr-2" /> Publish reel
        </Button>
      </Card>

      <div className="space-y-2">
        <h2 className="font-semibold">All reels ({reels.length})</h2>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && reels.length === 0 && <p className="text-sm text-muted-foreground">No reels yet.</p>}
        {reels.map((r, i) => (
          <Card key={r.id} className="p-3 flex items-center gap-3">
            {r.poster_url ? (
              <img src={r.poster_url} alt="" className="w-14 h-20 rounded object-cover bg-black" />
            ) : (
              <video src={r.video_url} className="w-14 h-20 rounded object-cover bg-black" muted />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{r.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                {r.product_provider && r.product_id ? `→ ${r.product_provider}/${r.product_id}` : (r.cta_url || '—')}
              </p>
              <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{r.views_count}</span>
                <span className="flex items-center gap-1"><MousePointerClick className="w-3 h-3" />{r.clicks_count}</span>
              </div>
            </div>
            <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} />
            <Button size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={i === reels.length - 1}><ArrowDown className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
