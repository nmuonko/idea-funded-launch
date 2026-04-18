import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, RefreshCw, Send, Trash2, CheckCircle2, MessageCircle, Layers, X } from 'lucide-react';
import { toast } from 'sonner';

interface Draft {
  id: string;
  caption: string | null;
  image_url: string;
  forwarded_from_chat_title: string | null;
  forwarded_from_chat_username: string | null;
  forwarded_by_username: string | null;
  suggested_title: string | null;
  suggested_brand: string | null;
  suggested_measurements: string | null;
  detected_category: string | null;
  status: string;
  created_at: string;
}

interface CountryRow {
  country: string;
  label_en: string;
  label_fr: string;
  flag_emoji: string;
}

const DEFAULT_COUNTRY = 'turkey';
const DEFAULT_WEIGHT = '0.7';

export default function TelegramImport() {
  const { language } = useLanguage();
  const isFr = language === 'fr';
  const t = (en: string, fr: string) => (isFr ? fr : en);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // form fields for the product being assembled from selected images
  const [form, setForm] = useState({
    title: '',
    country: DEFAULT_COUNTRY,
    price: '',
    weight: DEFAULT_WEIGHT,
    measurements: '',
    description: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ds }, { data: cs }] = await Promise.all([
      supabase
        .from('telegram_import_drafts')
        .select('id, caption, image_url, forwarded_from_chat_title, forwarded_from_chat_username, forwarded_by_username, suggested_title, suggested_brand, suggested_measurements, detected_category, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('country_shipping_rates')
        .select('country, label_en, label_fr, flag_emoji')
        .eq('enabled', true)
        .order('sort_order'),
    ]);
    setDrafts((ds as Draft[]) ?? []);
    setCountries((cs as CountryRow[]) ?? []);
    setSelected(new Set());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedDrafts = useMemo(
    () => drafts.filter((d) => selected.has(d.id)),
    [drafts, selected],
  );

  // auto-fill title / measurements from first selected draft when fields are empty
  useEffect(() => {
    if (selectedDrafts.length === 0) return;
    const first = selectedDrafts[0];
    const guessTitle = first.suggested_title || (first.caption || '').split('\n')[0]?.slice(0, 200) || '';
    const cap = (first.caption || '').slice(0, 1000);
    setForm((f) => ({
      ...f,
      title: f.title || guessTitle,
      description: f.description || cap,
      measurements: f.measurements || first.suggested_measurements || '',
    }));
  }, [selectedDrafts]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handlePollNow = async () => {
    setPolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-import-poll', {
        body: { manual: true },
      });
      if (error) throw error;
      toast.success(t(`Imported ${data?.processed ?? 0} new posts`, `${data?.processed ?? 0} nouveaux posts importés`));
      await load();
    } catch (e: any) {
      toast.error(e?.message || t('Failed to poll Telegram', 'Échec du sondage Telegram'));
    } finally {
      setPolling(false);
    }
  };

  const handlePublish = async () => {
    if (selectedDrafts.length === 0) return toast.error(t('Select at least one image', 'Sélectionnez au moins une image'));
    const price = parseFloat(form.price);
    const weight = parseFloat(form.weight);
    if (!form.title.trim()) return toast.error(t('Title is required', 'Titre obligatoire'));
    if (!isFinite(price) || price <= 0) return toast.error(t('Valid price required', 'Prix valide requis'));
    if (!isFinite(weight) || weight <= 0) return toast.error(t('Valid weight required', 'Poids valide requis'));
    if (!form.country) return toast.error(t('Country required', 'Pays requis'));

    setBusy(true);
    try {
      const images = selectedDrafts.map((d) => d.image_url);
      const first = selectedDrafts[0];
      const sourceUrl = first.forwarded_from_chat_username
        ? `https://t.me/${first.forwarded_from_chat_username}`
        : 'https://t.me/';

      const fullDescription = [
        form.description?.trim(),
        form.measurements?.trim() ? `\n\n📏 ${t('Measurements', 'Mensurations')}:\n${form.measurements.trim()}` : '',
      ].filter(Boolean).join('');

      const { data: prod, error: prodErr } = await supabase
        .from('international_products')
        .insert({
          country: form.country,
          title: form.title.trim(),
          image_url: images[0],
          images,
          measurements: form.measurements.trim() || null,
          product_url: sourceUrl,
          base_price_usd: price,
          est_weight_kg: weight,
          description: fullDescription || null,
        })
        .select('id')
        .single();
      if (prodErr) throw prodErr;

      const ids = selectedDrafts.map((d) => d.id);
      const { error: updErr } = await supabase
        .from('telegram_import_drafts')
        .update({
          status: 'published',
          reviewed_at: new Date().toISOString(),
          published_product_id: prod!.id,
          suggested_country: form.country,
          suggested_title: form.title.trim(),
          suggested_price_usd: price,
          suggested_weight_kg: weight,
        })
        .in('id', ids);
      if (updErr) throw updErr;

      toast.success(t(`Published with ${images.length} image(s)!`, `Publié avec ${images.length} image(s) !`));
      setDrafts((ds) => ds.filter((d) => !selected.has(d.id)));
      setSelected(new Set());
      setForm({ title: '', country: DEFAULT_COUNTRY, price: '', weight: DEFAULT_WEIGHT, measurements: '', description: '' });
    } catch (e: any) {
      toast.error(e?.message || t('Publish failed', 'Échec de la publication'));
    } finally {
      setBusy(false);
    }
  };

  const handleRejectSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase
        .from('telegram_import_drafts')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
      setDrafts((ds) => ds.filter((d) => !selected.has(d.id)));
      setSelected(new Set());
      toast.success(t('Rejected', 'Rejeté'));
    } catch (e: any) {
      toast.error(e?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Send className="h-6 w-6 text-primary" />
            {t('Telegram Clothing Import — Turkey', 'Import Vêtements Telegram — Turquie')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t(
              'Forward photos from Turkish clothing channels to your bot. Select all photos that belong to one product, fill in the details, and publish.',
              'Transférez des photos depuis les canaux de mode turcs. Sélectionnez toutes les photos d\'un même produit, remplissez les détails et publiez.',
            )}
          </p>
        </div>
        <Button onClick={handlePollNow} disabled={polling}>
          {polling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {t('Check Telegram now', 'Vérifier Telegram maintenant')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" />
            {t('How it works', 'Comment ça marche')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p><strong>1.</strong> {t('Forward photos from a Turkish clothing channel to your bot.', 'Transférez des photos d\'un canal turc de vêtements vers votre bot.')}</p>
          <p><strong>2.</strong> {t('Click each photo that belongs to the SAME product (front, back, detail, etc.).', 'Cliquez sur chaque photo appartenant au MÊME produit (avant, arrière, détail, etc.).')}</p>
          <p><strong>3.</strong> {t('Fill in title, price (USD), measurements and weight, then publish as one product with multiple images.', 'Remplissez titre, prix (USD), mensurations et poids, puis publiez en un produit avec plusieurs images.')}</p>
        </CardContent>
      </Card>

      <div className={`grid gap-6 ${selectedDrafts.length > 0 ? 'lg:grid-cols-[1fr_420px]' : 'grid-cols-1'}`}>
        <Card className="order-1 lg:order-1">
          <CardHeader>
            <CardTitle>
              {t('Available images', 'Images disponibles')}{' '}
              <Badge variant="secondary" className="ml-2">{drafts.length}</Badge>
            </CardTitle>
            <CardDescription>
              {t('Click images that belong to the same product to group them', 'Cliquez sur les images du même produit pour les grouper')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : drafts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {t('No pending images. Forward posts from Telegram to get started.', 'Aucune image. Transférez des posts depuis Telegram pour commencer.')}
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
                {drafts.map((d) => {
                  const isSel = selected.has(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggle(d.id)}
                      className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${
                        isSel ? 'border-primary ring-2 ring-primary/30 scale-[0.97]' : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <img src={d.image_url} alt="draft" className="w-full h-full object-cover" loading="lazy" />
                      <div className="absolute top-1.5 left-1.5">
                        <Checkbox checked={isSel} className="bg-background/90 border-background/90" />
                      </div>
                      {d.forwarded_from_chat_title && (
                        <Badge className="absolute bottom-1.5 left-1.5 bg-background/90 text-foreground text-[10px] py-0 px-1 max-w-[90%] truncate">
                          {d.forwarded_from_chat_title}
                        </Badge>
                      )}
                      {d.detected_category === 'suit' && (
                        <Badge className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground text-[10px] py-0 px-1.5">
                          🤵 Suit
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

      {/* Composer — side panel on lg+, top on mobile */}
      {selectedDrafts.length > 0 && (
        <Card className="border-primary/40 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto z-10 shadow-lg order-first lg:order-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-primary" />
                {t(`New product — ${selectedDrafts.length} image(s) selected`, `Nouveau produit — ${selectedDrafts.length} image(s) sélectionnée(s)`)}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4 mr-1" />{t('Clear', 'Effacer')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {selectedDrafts.map((d, i) => (
                <div key={d.id} className="relative flex-shrink-0">
                  <img src={d.image_url} alt={`sel-${i}`} className="h-20 w-20 object-cover rounded-md ring-2 ring-primary" />
                  <button
                    onClick={() => toggle(d.id)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    aria-label="remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  {i === 0 && (
                    <Badge className="absolute bottom-1 left-1 text-[10px] py-0 px-1">{t('Cover', 'Couv.')}</Badge>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-xs">{t('Title', 'Titre')}</Label>
                <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={t('e.g. Turkish wool overcoat — beige', 'ex: Manteau laine turc — beige')} />
              </div>
              <div>
                <Label className="text-xs">{t('Country', 'Pays')}</Label>
                <Select value={form.country} onValueChange={(v) => setForm((f) => ({ ...f, country: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {countries.map((c) => (
                      <SelectItem key={c.country} value={c.country}>
                        {c.flag_emoji} {isFr ? c.label_fr : c.label_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t('Price (USD)', 'Prix (USD)')}</Label>
                  <Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="e.g. 45" />
                </div>
                <div>
                  <Label className="text-xs">{t('Weight (kg)', 'Poids (kg)')}</Label>
                  <Input type="number" step="0.1" min="0.1" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} />
                </div>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">{t('Measurements (sizes, chest, length, etc.)', 'Mensurations (tailles, poitrine, longueur, etc.)')}</Label>
                <Textarea
                  rows={3}
                  value={form.measurements}
                  onChange={(e) => setForm((f) => ({ ...f, measurements: e.target.value }))}
                  placeholder={t('S: chest 96cm, length 70cm\nM: chest 100cm, length 72cm\nL: chest 104cm, length 74cm', 'S: poitrine 96cm, longueur 70cm\nM: poitrine 100cm, longueur 72cm\nL: poitrine 104cm, longueur 74cm')}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">{t('Description (optional)', 'Description (optionnel)')}</Label>
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder={t('Material, fit, notes…', 'Matière, coupe, notes…')}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handlePublish} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                {t('Publish product', 'Publier le produit')}
              </Button>
              <Button variant="outline" onClick={handleRejectSelected} disabled={busy}>
                <Trash2 className="h-4 w-4 mr-1" />
                {t('Reject selected', 'Rejeter sélection')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
