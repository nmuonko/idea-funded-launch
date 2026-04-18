import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Send, Trash2, CheckCircle2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Draft {
  id: string;
  caption: string | null;
  image_url: string;
  forwarded_from_chat_title: string | null;
  forwarded_from_chat_username: string | null;
  forwarded_by_username: string | null;
  suggested_title: string | null;
  status: string;
  created_at: string;
}

interface CountryRow {
  country: string;
  label_en: string;
  label_fr: string;
  flag_emoji: string;
}

export default function TelegramImport() {
  const { language } = useLanguage();
  const isFr = language === 'fr';
  const t = (en: string, fr: string) => (isFr ? fr : en);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [editing, setEditing] = useState<Record<string, { country: string; title: string; price: string; weight: string }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ds }, { data: cs }] = await Promise.all([
      supabase
        .from('telegram_import_drafts')
        .select('id, caption, image_url, forwarded_from_chat_title, forwarded_from_chat_username, forwarded_by_username, suggested_title, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('country_shipping_rates')
        .select('country, label_en, label_fr, flag_emoji')
        .eq('enabled', true)
        .order('sort_order'),
    ]);
    setDrafts((ds as Draft[]) ?? []);
    setCountries((cs as CountryRow[]) ?? []);
    // seed editing state
    const seed: typeof editing = {};
    (ds ?? []).forEach((d: any) => {
      seed[d.id] = {
        country: 'china',
        title: d.suggested_title || (d.caption || '').split('\n')[0]?.slice(0, 200) || '',
        price: '',
        weight: '0.5',
      };
    });
    setEditing(seed);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handlePollNow = async () => {
    setPolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-import-poll');
      if (error) throw error;
      toast.success(t(`Imported ${data?.processed ?? 0} new posts`, `${data?.processed ?? 0} nouveaux posts importés`));
      await load();
    } catch (e: any) {
      toast.error(e?.message || t('Failed to poll Telegram', 'Échec du sondage Telegram'));
    } finally {
      setPolling(false);
    }
  };

  const handlePublish = async (draft: Draft) => {
    const fields = editing[draft.id];
    if (!fields) return;
    const price = parseFloat(fields.price);
    const weight = parseFloat(fields.weight);
    if (!fields.title.trim()) return toast.error(t('Title is required', 'Titre obligatoire'));
    if (!isFinite(price) || price <= 0) return toast.error(t('Valid price required', 'Prix valide requis'));
    if (!isFinite(weight) || weight <= 0) return toast.error(t('Valid weight required', 'Poids valide requis'));
    if (!fields.country) return toast.error(t('Country required', 'Pays requis'));

    setBusy((b) => ({ ...b, [draft.id]: true }));
    try {
      const sourceUrl =
        draft.forwarded_from_chat_username && draft.forwarded_from_chat_username
          ? `https://t.me/${draft.forwarded_from_chat_username}`
          : 'https://t.me/';
      const { data: prod, error: prodErr } = await supabase
        .from('international_products')
        .insert({
          country: fields.country,
          title: fields.title.trim(),
          image_url: draft.image_url,
          product_url: sourceUrl,
          base_price_usd: price,
          est_weight_kg: weight,
          description: draft.caption,
        })
        .select('id')
        .single();
      if (prodErr) throw prodErr;

      const { error: updErr } = await supabase
        .from('telegram_import_drafts')
        .update({
          status: 'published',
          reviewed_at: new Date().toISOString(),
          published_product_id: prod!.id,
          suggested_country: fields.country,
          suggested_title: fields.title.trim(),
          suggested_price_usd: price,
          suggested_weight_kg: weight,
        })
        .eq('id', draft.id);
      if (updErr) throw updErr;

      toast.success(t('Published!', 'Publié !'));
      setDrafts((ds) => ds.filter((d) => d.id !== draft.id));
    } catch (e: any) {
      toast.error(e?.message || t('Publish failed', 'Échec de la publication'));
    } finally {
      setBusy((b) => ({ ...b, [draft.id]: false }));
    }
  };

  const handleReject = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const { error } = await supabase
        .from('telegram_import_drafts')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      setDrafts((ds) => ds.filter((d) => d.id !== id));
      toast.success(t('Rejected', 'Rejeté'));
    } catch (e: any) {
      toast.error(e?.message);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Send className="h-6 w-6 text-primary" />
            {t('Telegram Product Import', 'Import Produits Telegram')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t(
              'Forward photos from any Telegram channel to your bot. They appear here for review.',
              'Transférez des photos depuis tout canal Telegram vers votre bot. Elles apparaissent ici pour révision.',
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
            {t('How to import', 'Comment importer')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>1.</strong>{' '}
            {t(
              'Open any Telegram channel (e.g. DANIEL ESPINO MENS WEAR, dnsp34, etc.)',
              "Ouvrez n'importe quel canal Telegram (ex: DANIEL ESPINO MENS WEAR, dnsp34, etc.)",
            )}
          </p>
          <p>
            <strong>2.</strong>{' '}
            {t(
              'Long-press a post with a photo → tap Forward → search for your bot → send.',
              "Appuyez longuement sur un post avec photo → Transférer → cherchez votre bot → envoyez.",
            )}
          </p>
          <p>
            <strong>3.</strong>{' '}
            {t(
              'Within 5 minutes (or click "Check Telegram now"), the photo appears below as a draft.',
              "Dans les 5 minutes (ou cliquez sur «Vérifier Telegram maintenant»), la photo apparaît ici comme brouillon.",
            )}
          </p>
          <p>
            <strong>4.</strong>{' '}
            {t(
              'Set country, price (USD), weight (kg), then click Publish.',
              'Définissez pays, prix (USD), poids (kg), puis cliquez sur Publier.',
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('Pending drafts', 'Brouillons en attente')}{' '}
            <Badge variant="secondary" className="ml-2">{drafts.length}</Badge>
          </CardTitle>
          <CardDescription>
            {t('Review and publish forwarded items', 'Réviser et publier les éléments transférés')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : drafts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {t(
                'No pending drafts. Forward a post from Telegram to get started.',
                'Aucun brouillon. Transférez un post depuis Telegram pour commencer.',
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {drafts.map((d) => {
                const fields = editing[d.id] || { country: 'china', title: '', price: '', weight: '0.5' };
                const set = (k: keyof typeof fields, v: string) =>
                  setEditing((e) => ({ ...e, [d.id]: { ...fields, [k]: v } }));
                return (
                  <Card key={d.id} className="overflow-hidden border-2">
                    <div className="aspect-square bg-muted relative">
                      <img src={d.image_url} alt="draft" className="w-full h-full object-cover" loading="lazy" />
                      {d.forwarded_from_chat_title && (
                        <Badge className="absolute top-2 left-2 bg-background/90 text-foreground">
                          {d.forwarded_from_chat_title}
                        </Badge>
                      )}
                    </div>
                    <CardContent className="p-4 space-y-3">
                      {d.caption && (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                          {d.caption}
                        </p>
                      )}
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs">{t('Title', 'Titre')}</Label>
                          <Input
                            value={fields.title}
                            onChange={(e) => set('title', e.target.value)}
                            placeholder={t('Product name', 'Nom du produit')}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">{t('Country', 'Pays')}</Label>
                            <Select value={fields.country} onValueChange={(v) => set('country', v)}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {countries.map((c) => (
                                  <SelectItem key={c.country} value={c.country}>
                                    {c.flag_emoji} {isFr ? c.label_fr : c.label_en}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">{t('Weight (kg)', 'Poids (kg)')}</Label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={fields.weight}
                              onChange={(e) => set('weight', e.target.value)}
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">{t('Base price (USD)', 'Prix de base (USD)')}</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={fields.price}
                            onChange={(e) => set('price', e.target.value)}
                            placeholder="e.g. 12.50"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button
                          onClick={() => handlePublish(d)}
                          disabled={busy[d.id]}
                          className="flex-1"
                          size="sm"
                        >
                          {busy[d.id] ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                          )}
                          {t('Publish', 'Publier')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReject(d.id)}
                          disabled={busy[d.id]}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
