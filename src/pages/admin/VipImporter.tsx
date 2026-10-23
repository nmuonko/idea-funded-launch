// /admin/vip-importer — ChatGPT-style AI importer for the VIP store.
// Upload photos in the composer; the AI identifies, categorises, prices
// (server-side) and asks only for missing info. Everything stays in chat.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { vipPublishRequest } from '@/lib/vipPublishRequest';
import { ArrowUp, Paperclip, Plus, Loader2, X, Shirt, MessageSquare, Pencil } from 'lucide-react';

interface Thread { id: string; title: string; updated_at: string }
interface Msg {
  id: string; role: 'user' | 'assistant'; content: string; attachments: string[];
  blocks: { product_ids?: string[]; quick?: string[]; display?: 'cards' | 'grid' }; created_at: string;
}
interface Prod {
  id: string; name_en: string | null; name_fr: string | null; image_url: string; category_id: string | null;
  final_price: number | null; purchase_price: number | null; shipping_cost: number | null;
  shipping_buffer: number | null; profit: number | null; status: string; colors: string[]; sizes: string[];
  needs_review: boolean;
  gallery_product_id?: string | null;
}
interface Cat { id: string; name: string }

const dayLabel = (iso: string) => {
  const d = new Date(iso); const t = new Date();
  const diff = Math.floor((new Date(t.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const money = (n: number | null) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

export default function VipImporter() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const threadId = params.get('thread');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [products, setProducts] = useState<Record<string, Prod>>({});
  const [cats, setCats] = useState<Cat[]>([]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Prod | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase.from('vip_import_threads').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(40);
    setThreads((data ?? []) as Thread[]);
  }, []);

  const loadThread = useCallback(async (id: string | null) => {
    if (!id) { setMessages([]); setProducts({}); return; }
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase.from('vip_import_messages').select('*').eq('thread_id', id).order('created_at'),
       supabase.from('vip_products').select('id, name_en, name_fr, image_url, category_id, final_price, purchase_price, shipping_cost, shipping_buffer, profit, status, colors, sizes, needs_review, gallery_product_id').eq('thread_id', id),
    ]);
    setMessages((m ?? []) as unknown as Msg[]);
    setProducts(Object.fromEntries(((p ?? []) as unknown as Prod[]).map((x) => [x.id, x])));
  }, []);

  useEffect(() => { loadThreads(); supabase.from('vip_categories').select('id, name').then(({ data }) => setCats((data ?? []) as Cat[])); }, [loadThreads]);
  useEffect(() => { loadThread(threadId); taRef.current?.focus(); }, [threadId, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const addFiles = (list: FileList | File[]) => {
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...imgs.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 50));
    taRef.current?.focus();
  };

  const send = async (override?: string) => {
    const msgText = (override ?? text).trim();
    if (busy || (!msgText && !files.length)) return;
    if (override === 'Review products') {
      const last = [...messages].reverse().find((m) => m.blocks?.product_ids?.length);
      if (last) setExpanded((s) => new Set(s).add(last.id));
      return;
    }
    setBusy(true);
    const pending = files; setFiles([]); setText('');
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [...m, { id: tempId, role: 'user', content: msgText, attachments: pending.map((f) => f.url), blocks: {}, created_at: new Date().toISOString() }]);
    try {
      const folder = crypto.randomUUID();
      const urls: string[] = [];
      for (let i = 0; i < pending.length; i++) {
        const f = pending[i].file;
        const ext = f.type.includes('png') ? 'png' : f.type.includes('webp') ? 'webp' : 'jpg';
        const path = `vip-chat/${folder}/${i + 1}.${ext}`;
        const { error } = await supabase.storage.from('product-images').upload(path, f, { contentType: f.type, upsert: true });
        if (error) throw new Error('Photo upload failed');
        urls.push(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl);
      }
      const { data, error } = await supabase.functions.invoke('vip-importer-chat', { body: { thread_id: threadId, text: msgText, images: urls } });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Request failed');
      if (data.thread_id !== threadId) setParams({ thread: data.thread_id });
      await loadThread(data.thread_id);
      loadThreads();
    } catch (e) {
      toast({ title: 'Something went wrong', description: (e as Error).message, variant: 'destructive' });
      setMessages((m) => m.filter((x) => x.id !== tempId));
    } finally {
      setBusy(false); taRef.current?.focus();
    }
  };

  const productAction = async (p: Prod, status: string) => {
    try {
      await vipPublishRequest({ action: 'set_status', product_ids: [p.id], status });
    } catch (error) {
      toast({ title: 'Not updated', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' }); return;
    }
    setProducts((s) => ({ ...s, [p.id]: { ...p, status } }));
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await vipPublishRequest({ action: 'edit', product_id: editing.id, name_en: editing.name_en ?? '', name_fr: editing.name_fr ?? '', colors: editing.colors, sizes: editing.sizes, final_price: editing.final_price });
    } catch (error) {
      toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' }); return;
    }
    setProducts((s) => ({ ...s, [editing.id]: editing })); setEditing(null);
  };

  const catName = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats]);
  const lastId = messages[messages.length - 1]?.id;

  const ProductCard = ({ p, compact }: { p: Prod; compact?: boolean }) => (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="aspect-square bg-muted"><img src={p.image_url} alt={p.name_en ?? ''} className="w-full h-full object-cover" loading="lazy" /></div>
      <div className="p-3 space-y-1.5 flex-1 flex flex-col">
        <p className="text-sm font-medium leading-snug line-clamp-2">{p.name_en ?? p.name_fr ?? 'Untitled'}</p>
        <p className="text-xs text-muted-foreground">{p.category_id ? catName[p.category_id] : 'No category'}{p.colors?.length ? ` · ${p.colors.join(', ')}` : ''}</p>
        {!compact && p.sizes?.length > 0 && <p className="text-xs text-muted-foreground">Sizes: {p.sizes.join(', ')}</p>}
        {!compact && p.purchase_price != null && (
          <p className="text-[11px] text-muted-foreground">Paid {money(p.purchase_price)} · Ship {money(p.shipping_cost)} · Buffer {money(p.shipping_buffer)} · Profit {money(p.profit)}</p>
        )}
        <div className="flex items-center justify-between pt-1 mt-auto">
          <span className="text-base font-semibold">{money(p.final_price)}</span>
          <span className={cn('text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border',
            p.status === 'available' ? 'border-success/40 text-success' : p.status === 'unavailable' ? 'border-warning/40 text-warning' : 'border-border text-muted-foreground')}>
            {p.status === 'available' ? 'Live' : p.status}
          </span>
        </div>
        <div className="flex gap-1 pt-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(p)}><Pencil className="h-3 w-3 mr-1" />Edit</Button>
          {p.status !== 'unavailable' && p.status !== 'draft' && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => productAction(p, 'unavailable')}>Unavailable</Button>}
          {p.status !== 'available' && <Button size="sm" variant="secondary" className="h-7 px-2 text-xs ml-auto" onClick={() => productAction(p, 'available')}>Publish</Button>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-4 md:-m-6 bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="p-4 flex items-center gap-2 font-semibold"><Shirt className="h-4 w-4 text-primary" />AI VIP Importer</div>
        <div className="px-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => setParams({})}><Plus className="h-4 w-4 mr-2" />New Import</Button>
        </div>
        <p className="px-4 pt-5 pb-2 text-xs text-muted-foreground">Recent</p>
        <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
          {threads.map((t) => (
            <button key={t.id} onClick={() => setParams({ thread: t.id })}
              className={cn('w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-muted transition-colors', t.id === threadId && 'bg-muted')}>
              <span className="block truncate">{t.title}</span>
              <span className="text-xs text-muted-foreground">{dayLabel(t.updated_at)}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Chat */}
      <main className={cn('flex-1 flex flex-col min-w-0 relative', dragging && 'ring-2 ring-primary/50 ring-inset')}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
        <div className="md:hidden flex items-center gap-2 p-3 border-b border-border">
          <Button size="sm" variant="outline" onClick={() => setParams({})}><Plus className="h-4 w-4" /></Button>
          <select className="flex-1 bg-background border border-border rounded-md text-sm h-9 px-2" value={threadId ?? ''} onChange={(e) => setParams(e.target.value ? { thread: e.target.value } : {})}>
            <option value="">New import</option>
            {threads.map((t) => <option key={t.id} value={t.id}>{t.title} — {dayLabel(t.updated_at)}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !busy ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <h1 className="text-2xl md:text-3xl font-semibold">What would you like to import?</h1>
              <p className="mt-3 max-w-md text-sm text-muted-foreground">Upload clothing or fashion product photos and I'll identify them, calculate the selling price, and prepare them for your VIP store.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
              {messages.map((m) => {
                const ids = [...new Set((m.blocks?.product_ids ?? []).map((id) => products[id]?.gallery_product_id ?? id))].filter((id) => products[id]);
                const grid = ids.length > 4 && !expanded.has(m.id);
                return m.role === 'user' ? (
                  <div key={m.id} className="flex flex-col items-end gap-2">
                    {m.attachments?.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5 max-w-md">
                        {m.attachments.slice(0, 12).map((u) => <img key={u} src={u} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />)}
                        {m.attachments.length > 12 && <div className="h-20 w-20 rounded-lg bg-muted grid place-items-center text-sm">+{m.attachments.length - 12}</div>}
                      </div>
                    )}
                    {m.content && <div className="rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 max-w-[80%] text-sm whitespace-pre-wrap">{m.content}</div>}
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-3">
                    <div className="h-7 w-7 shrink-0 rounded-full bg-primary/15 text-primary grid place-items-center"><Shirt className="h-3.5 w-3.5" /></div>
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                      {ids.length > 0 && (grid ? (
                        <button onClick={() => setExpanded((s) => new Set(s).add(m.id))} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 hover:bg-muted transition-colors">
                          <div className="flex -space-x-3">{ids.slice(0, 4).map((id) => <img key={id} src={products[id].image_url} alt="" className="h-9 w-9 rounded-md object-cover border-2 border-background" />)}</div>
                          <span className="text-sm font-medium">{ids.length} products</span><span className="text-sm text-primary">View products</span>
                        </button>
                      ) : (
                        <div className={cn('grid gap-3', ids.length > 4 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3')}>
                          {ids.map((id) => <ProductCard key={id} p={products[id]} compact={ids.length > 4} />)}
                        </div>
                      ))}
                      {m.id === lastId && !busy && (m.blocks?.quick ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {m.blocks.quick!.map((q) => (
                            <Button key={q} size="sm" variant="outline" className="rounded-full" onClick={() => send(q)}>{q}</Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {busy && (
                <div className="flex gap-3 items-center text-sm text-muted-foreground">
                  <div className="h-7 w-7 rounded-full bg-primary/15 text-primary grid place-items-center"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
                  {files.length || messages[messages.length - 1]?.attachments?.length ? 'Analyzing photos…' : 'Thinking…'}
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-4 pb-4 pt-2">
          <div className="max-w-3xl mx-auto rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/50 transition-colors">
            {files.length > 0 && (
              <div className="flex gap-2 p-3 pb-0 overflow-x-auto">
                {files.map((f, i) => (
                  <div key={f.url} className="relative shrink-0">
                    <img src={f.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    <button aria-label="Remove photo" onClick={() => setFiles((s) => s.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border grid place-items-center"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 p-2">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              <Button size="icon" variant="ghost" className="shrink-0 rounded-full" aria-label="Upload photos" onClick={() => fileRef.current?.click()}><Paperclip className="h-5 w-5" /></Button>
              <Textarea ref={taRef} value={text} rows={1} placeholder="Upload photos or message AfriShop AI…"
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => { if (e.clipboardData.files.length) addFiles(e.clipboardData.files); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="min-h-[40px] max-h-40 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none" />
              <Button size="icon" className="shrink-0 rounded-full" aria-label="Send" disabled={busy || (!text.trim() && !files.length)} onClick={() => send()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground mt-2 flex items-center justify-center gap-1"><MessageSquare className="h-3 w-3" />Try: "$12 each" · "Sizes M to XXL" · "Mark the black one unavailable" · "Publish all except 6"</p>
        </div>
      </main>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit product</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Input value={editing.name_en ?? ''} onChange={(e) => setEditing({ ...editing, name_en: e.target.value })} placeholder="English title" />
              <Input value={editing.name_fr ?? ''} onChange={(e) => setEditing({ ...editing, name_fr: e.target.value })} placeholder="French title" />
              <Input value={editing.colors.join(', ')} onChange={(e) => setEditing({ ...editing, colors: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="Colors (comma separated)" />
              <Input value={editing.sizes.join(', ')} onChange={(e) => setEditing({ ...editing, sizes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="Sizes (comma separated)" />
              <Input type="number" step="0.01" value={editing.final_price ?? ''} onChange={(e) => setEditing({ ...editing, final_price: e.target.value ? Number(e.target.value) : null })} placeholder="Selling price" />
            </div>
          )}
          <DialogFooter><Button onClick={saveEdit}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
