import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, ArrowUp, ArrowDown, Search, Sparkles, FlaskConical } from 'lucide-react';

type Faq = {
  id: string;
  language: string;
  question: string;
  answer: string;
  tags: string[] | null;
  trigger_phrases: string[] | null;
  is_active: boolean;
  priority: number;
};

const empty = (): Partial<Faq> => ({
  language: 'fr',
  question: '',
  answer: '',
  tags: [],
  trigger_phrases: [],
  is_active: true,
  priority: 50,
});

function scoreFaq(message: string, f: Faq): number {
  const m = message.toLowerCase();
  if (!m) return 0;
  let s = 0;
  for (const p of f.trigger_phrases || []) if (p && m.includes(p.toLowerCase())) s += 3;
  for (const t of f.tags || []) if (t && m.includes(t.toLowerCase())) s += 1;
  for (const w of (f.question || '').toLowerCase().split(/\W+/).filter((x) => x.length > 4)) {
    if (m.includes(w)) s += 1;
  }
  return s;
}

export default function SophieFAQs() {
  const [rows, setRows] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Faq | null>(null);
  const [form, setForm] = useState<Partial<Faq>>(empty());
  const [testQuery, setTestQuery] = useState('');

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('faq_kb')
      .select('*')
      .order('priority', { ascending: false })
      .order('language', { ascending: true });
    if (error) toast.error(error.message);
    setRows((data || []) as Faq[]);
    setLoading(false);
  };

  useEffect(() => { fetchRows(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (langFilter !== 'all' && r.language !== langFilter) return false;
      if (!q) return true;
      return (
        r.question.toLowerCase().includes(q) ||
        r.answer.toLowerCase().includes(q) ||
        (r.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (r.trigger_phrases || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [rows, search, langFilter]);

  const ragPreview = useMemo(() => {
    if (!testQuery.trim()) return [];
    const lang = langFilter === 'all' ? null : langFilter;
    return rows
      .filter((r) => r.is_active && (!lang || r.language === lang))
      .map((r) => ({ row: r, score: scoreFaq(testQuery, r) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [rows, testQuery, langFilter]);

  const openCreate = () => { setEditing(null); setForm(empty()); setOpen(true); };
  const openEdit = (r: Faq) => {
    setEditing(r);
    setForm({ ...r, tags: r.tags || [], trigger_phrases: r.trigger_phrases || [] });
    setOpen(true);
  };

  const save = async () => {
    const payload = {
      language: form.language || 'fr',
      question: (form.question || '').trim(),
      answer: (form.answer || '').trim(),
      tags: form.tags || [],
      trigger_phrases: form.trigger_phrases || [],
      is_active: !!form.is_active,
      priority: Number(form.priority ?? 50),
    };
    if (!payload.question || !payload.answer) { toast.error('Question and answer required'); return; }
    const op = editing
      ? supabase.from('faq_kb').update(payload).eq('id', editing.id)
      : supabase.from('faq_kb').insert(payload);
    const { error } = await op;
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? 'FAQ updated' : 'FAQ created');
    setOpen(false);
    fetchRows();
  };

  const remove = async (r: Faq) => {
    if (!confirm(`Delete: "${r.question}"?`)) return;
    const { error } = await supabase.from('faq_kb').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Deleted');
    fetchRows();
  };

  const bumpPriority = async (r: Faq, delta: number) => {
    const next = Math.max(0, Math.min(100, r.priority + delta));
    if (next === r.priority) return;
    const { error } = await supabase.from('faq_kb').update({ priority: next }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, priority: next } : x)).sort((a, b) => b.priority - a.priority));
  };

  const toggleActive = async (r: Faq) => {
    const { error } = await supabase.from('faq_kb').update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="h-6 w-6" /> Sophie FAQs</h1>
          <p className="text-muted-foreground text-sm">{rows.length} entries · drives Sophie's RAG retrieval</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New FAQ</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardContent className="pt-4 flex gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search question / answer / tag / trigger…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={langFilter} onValueChange={setLangFilter}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ln">Lingala</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && filtered.length === 0 && <p className="text-sm text-muted-foreground">No FAQs match.</p>}
            {filtered.map((r) => (
              <Card key={r.id} className={r.is_active ? '' : 'opacity-60'}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline">{r.language.toUpperCase()}</Badge>
                        <Badge variant="secondary">P {r.priority}</Badge>
                        <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} />
                      </div>
                      <h3 className="font-semibold leading-tight">{r.question}</h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.answer}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(r.trigger_phrases || []).slice(0, 6).map((t, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="icon" variant="ghost" onClick={() => bumpPriority(r, +5)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => bumpPriority(r, -5)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Edit className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5" /> Live RAG Preview</CardTitle>
              <CardDescription>Type a customer question to see which FAQs Sophie would pull in.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={3}
                placeholder="e.g. C'est en carton ? / Why so long?"
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
              />
              {testQuery.trim() && ragPreview.length === 0 && (
                <p className="text-sm text-destructive">⚠️ No FAQ matched — Sophie may escalate.</p>
              )}
              {ragPreview.map(({ row, score }, i) => (
                <div key={row.id} className="border rounded p-2 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge>#{i + 1}</Badge>
                    <Badge variant="secondary">score {score}</Badge>
                    <Badge variant="outline">{row.language}</Badge>
                  </div>
                  <div className="font-medium">{row.question}</div>
                  <div className="text-muted-foreground line-clamp-2">{row.answer}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit FAQ' : 'New FAQ'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Language</label>
                <Select value={form.language} onValueChange={(v) => setForm((f) => ({ ...f, language: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ln">Lingala</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Priority (0–100)</label>
                <Input type="number" value={form.priority ?? 50} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Question</label>
              <Input value={form.question || ''} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Answer</label>
              <Textarea rows={4} value={form.answer || ''} onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Tags (comma-separated)</label>
              <Input
                value={(form.tags || []).join(', ')}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Trigger phrases (comma-separated)</label>
              <Textarea
                rows={2}
                value={(form.trigger_phrases || []).join(', ')}
                onChange={(e) => setForm((f) => ({ ...f, trigger_phrases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={!!form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              <label className="text-sm">Active (visible to Sophie)</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Save changes' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
