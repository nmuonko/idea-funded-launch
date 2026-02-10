import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Pencil, Trash2, Loader2, Target, Bell } from 'lucide-react';

interface Marketer {
  id: string;
  marketer_name: string;
  ref_code: string;
  threshold_count: number;
  is_enabled: boolean;
  last_notified_count: number | null;
  notified_at: string | null;
  created_at: string;
  verified_count?: number;
}

export default function AdminMarketers() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [marketers, setMarketers] = useState<Marketer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Marketer | null>(null);
  const [form, setForm] = useState({ marketer_name: '', ref_code: '', threshold_count: 100 });
  const isFr = language === 'fr';

  const loadData = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('marketer_thresholds')
        .select('*')
        .order('created_at', { ascending: false });

      if (data) {
        // Count verified signups per ref_code
        const refCodes = data.map(m => m.ref_code);
        const enriched: Marketer[] = [];

        for (const m of data) {
          const { count } = await supabase
            .from('referral_rewards')
            .select('*', { count: 'exact', head: true })
            .eq('ref_code', m.ref_code);

          enriched.push({ ...m, verified_count: count || 0 });
        }
        setMarketers(enriched);
      }
    } catch (err) {
      console.error('Error loading marketers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSave = async () => {
    if (!form.marketer_name || !form.ref_code || !form.threshold_count) {
      toast({ title: isFr ? 'Champs requis' : 'Required fields', variant: 'destructive' });
      return;
    }

    if (editing) {
      const { error } = await supabase
        .from('marketer_thresholds')
        .update({
          marketer_name: form.marketer_name,
          ref_code: form.ref_code,
          threshold_count: form.threshold_count,
        })
        .eq('id', editing.id);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }
    } else {
      const { error } = await supabase
        .from('marketer_thresholds')
        .insert({
          marketer_name: form.marketer_name,
          ref_code: form.ref_code,
          threshold_count: form.threshold_count,
        });

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }
    }

    toast({ title: isFr ? 'Sauvegardé' : 'Saved' });
    setDialogOpen(false);
    setEditing(null);
    setForm({ marketer_name: '', ref_code: '', threshold_count: 100 });
    loadData();
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await supabase.from('marketer_thresholds').update({ is_enabled: enabled }).eq('id', id);
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(isFr ? 'Supprimer ce marketeur ?' : 'Delete this marketer?')) return;
    await supabase.from('marketer_thresholds').delete().eq('id', id);
    toast({ title: isFr ? 'Supprimé' : 'Deleted' });
    loadData();
  };

  const openEdit = (m: Marketer) => {
    setEditing(m);
    setForm({ marketer_name: m.marketer_name, ref_code: m.ref_code, threshold_count: m.threshold_count });
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ marketer_name: '', ref_code: '', threshold_count: 100 });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Target className="h-6 w-6" />
          {isFr ? 'Marketeurs & Seuils' : 'Marketers & Thresholds'}
        </h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              {isFr ? 'Ajouter' : 'Add'}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editing
                  ? (isFr ? 'Modifier le marketeur' : 'Edit marketer')
                  : (isFr ? 'Nouveau marketeur' : 'New marketer')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>{isFr ? 'Nom' : 'Name'}</Label>
                <Input
                  value={form.marketer_name}
                  onChange={e => setForm(f => ({ ...f, marketer_name: e.target.value }))}
                  placeholder="John Doe"
                />
              </div>
              <div>
                <Label>{isFr ? 'Code de parrainage' : 'Referral code'}</Label>
                <Input
                  value={form.ref_code}
                  onChange={e => setForm(f => ({ ...f, ref_code: e.target.value }))}
                  placeholder="JOHN100"
                  disabled={!!editing}
                />
              </div>
              <div>
                <Label>{isFr ? 'Seuil (inscriptions vérifiées)' : 'Threshold (verified signups)'}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.threshold_count}
                  onChange={e => setForm(f => ({ ...f, threshold_count: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <Button onClick={handleSave} className="w-full">
                {isFr ? 'Sauvegarder' : 'Save'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isFr ? 'Suivi des marketeurs' : 'Marketer tracking'}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : marketers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {isFr ? 'Aucun marketeur configuré' : 'No marketers configured'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isFr ? 'Nom' : 'Name'}</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>{isFr ? 'Vérifiés' : 'Verified'}</TableHead>
                  <TableHead>{isFr ? 'Seuil' : 'Threshold'}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>{isFr ? 'Actif' : 'Enabled'}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marketers.map(m => {
                  const reached = (m.verified_count || 0) >= m.threshold_count;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.marketer_name}</TableCell>
                      <TableCell><code className="text-xs">{m.ref_code}</code></TableCell>
                      <TableCell className="font-bold">{m.verified_count || 0}</TableCell>
                      <TableCell>{m.threshold_count}</TableCell>
                      <TableCell>
                        <Badge variant={reached ? 'default' : 'secondary'} className="flex items-center gap-1 w-fit">
                          {reached && <Bell className="h-3 w-3" />}
                          {reached
                            ? (isFr ? 'Atteint' : 'Reached')
                            : (isFr ? 'En cours' : 'In progress')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={m.is_enabled}
                          onCheckedChange={v => toggleEnabled(m.id, v)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(m)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDelete(m.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
