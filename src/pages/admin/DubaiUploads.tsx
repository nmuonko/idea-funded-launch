// /admin/dubai-uploads — review queue for Dubai supplier submissions.
import { useEffect, useState } from 'react';
import { Loader2, Check, X, Edit2, Image as ImgIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Row {
  id: string;
  created_at: string;
  status: string;
  category: string;
  model: string | null;
  model_other_text: string | null;
  refined_title: string | null;
  storage: string | null;
  color: string | null;
  condition: string | null;
  battery_health: number | null;
  dubai_price_aed: number | null;
  dubai_price_usd: number | null;
  final_price_usd: number | null;
  images: string[];
  public_description: string | null;
  supplier_notes: string | null;
  published_showcase_id: string | null;
}

export default function AdminDubaiUploads() {
  const [tab, setTab] = useState('pending_review');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('dubai_uploads' as any)
      .select('*')
      .eq('status', tab)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    setRows((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  const setToken = async () => {
    if (tokenInput.length < 12) { toast.error('Token trop court (≥ 12 caractères)'); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('dubai-upload-admin', {
      body: { action: 'set-token', token: tokenInput },
    });

    setBusy(false);
    if (error || !(data as any)?.ok) { toast.error('Échec'); return; }
    toast.success('Token mis à jour');
    setTokenInput('');
  };

  const approve = async (row: Row, patch: Partial<Row>) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('dubai-upload-admin', {
      body: { action: 'approve', id: row.id, patch },
    });

    setBusy(false);
    if (error || !(data as any)?.ok) { toast.error((data as any)?.error || 'Échec'); return; }
    toast.success('Produit publié sur /hot-products');
    setEditing(null);
    load();
  };

  const reject = async (id: string) => {
    if (!confirm('Rejeter cette soumission ?')) return;
    setBusy(true);
    await supabase.functions.invoke('dubai-upload-admin?action=reject', { body: { id } });
    setBusy(false);
    load();
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Uploads Dubai</h1>
        <p className="text-sm text-muted-foreground">Révisez et approuvez les produits envoyés depuis Dubai.</p>
      </div>

      <div className="rounded-lg border p-4 bg-muted/30">
        <Label className="text-xs">Définir / changer le token d’upload Dubai</Label>
        <div className="flex gap-2 mt-1">
          <Input value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="Nouveau token (≥ 12 caractères)" />
          <Button onClick={setToken} disabled={busy}>Enregistrer</Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Lien à partager: <code>/dubai-upload?token=VOTRE_TOKEN</code>
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending_review">À réviser</TabsTrigger>
          <TabsTrigger value="approved">Approuvés</TabsTrigger>
          <TabsTrigger value="rejected">Rejetés</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Aucun élément.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {rows.map(r => (
                <div key={r.id} className="border rounded-lg overflow-hidden flex gap-3 p-3 bg-card">
                  <div className="w-24 h-24 bg-muted rounded overflow-hidden flex-shrink-0">
                    {r.images?.[0] ? (
                      <img src={r.images[0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><ImgIcon className="h-6 w-6 text-muted-foreground" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm line-clamp-2">
                      {r.refined_title || `${r.model || r.model_other_text || r.category} ${r.storage || ''} ${r.color || ''}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.condition || '—'} · {r.battery_health ? `${r.battery_health}% bat` : ''}
                    </p>
                    <p className="text-xs mt-1">
                      Prix client: <span className="font-semibold">{r.final_price_usd ? `$${r.final_price_usd}` : '—'}</span>
                      {r.dubai_price_aed ? <span className="text-muted-foreground"> · AED {r.dubai_price_aed}</span> : null}
                    </p>
                    {tab === 'pending_review' && (
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                          <Edit2 className="h-3 w-3 mr-1" /> Réviser
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => reject(r.id)}>
                          <X className="h-3 w-3 mr-1" /> Rejeter
                        </Button>
                      </div>
                    )}
                    {tab === 'approved' && r.published_showcase_id && (
                      <p className="text-[11px] text-emerald-600 mt-1">Publié ✓</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {editing && (
        <EditDialog row={editing} onClose={() => setEditing(null)} onApprove={approve} busy={busy} />
      )}
    </div>
  );
}

function EditDialog({ row, onClose, onApprove, busy }: {
  row: Row;
  onClose: () => void;
  onApprove: (row: Row, patch: any) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(row.refined_title || '');
  const [price, setPrice] = useState(row.final_price_usd?.toString() || '');
  const [desc, setDesc] = useState(row.public_description || '');
  const [cond, setCond] = useState(row.condition || '');
  const [bat, setBat] = useState(row.battery_health?.toString() || '');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Réviser et approuver</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {row.images?.[0] && <img src={row.images[0]} alt="" className="w-full max-h-48 object-contain rounded border" />}
          <div className="grid grid-cols-1 gap-3">
            <div><Label>Titre</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Prix final (USD)</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} /></div>
              <div><Label>Batterie (%)</Label><Input type="number" value={bat} onChange={e => setBat(e.target.value)} /></div>
            </div>
            <div><Label>État</Label><Input value={cond} onChange={e => setCond(e.target.value)} /></div>
            <div><Label>Description publique</Label><Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} /></div>
            {row.supplier_notes && (
              <p className="text-xs text-muted-foreground border-l-2 pl-2 italic">Note fournisseur: {row.supplier_notes}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            disabled={busy || !title.trim() || !Number(price)}
            onClick={() => onApprove(row, {
              refined_title: title.trim(),
              final_price_usd: Number(price),
              public_description: desc || null,
              condition: cond || null,
              battery_health: bat ? Number(bat) : null,
            })}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
            Approuver & publier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
