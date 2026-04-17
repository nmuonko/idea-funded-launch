import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Globe2 } from 'lucide-react';
import { toast } from 'sonner';

interface CountryRow {
  country: string;
  label_en: string;
  label_fr: string;
  flag_emoji: string;
  rate_per_kg_usd: number;
  enabled: boolean;
  sort_order: number;
}

export default function CountryShippingRates() {
  const { language } = useLanguage();
  const isFr = language === 'fr';
  const t = (en: string, fr: string) => (isFr ? fr : en);

  const [rows, setRows] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase.from('country_shipping_rates' as any)
      .select('*')
      .order('sort_order', { ascending: true }) as any);
    if (Array.isArray(data)) setRows(data as CountryRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateLocal = (country: string, patch: Partial<CountryRow>) => {
    setRows((prev) => prev.map((r) => (r.country === country ? { ...r, ...patch } : r)));
  };

  const save = async (row: CountryRow) => {
    setSavingKey(row.country);
    const { error } = await (supabase.from('country_shipping_rates' as any).update({
      rate_per_kg_usd: Number(row.rate_per_kg_usd),
      enabled: row.enabled,
    }).eq('country', row.country) as any);
    setSavingKey(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('Saved', 'Enregistré'));
  };

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe2 className="h-6 w-6 text-primary" />
          {t('Country shipping rates', 'Tarifs d\'expédition par pays')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t(
            'Set the per-kg shipping rate for each origin country. USA uses the existing fees for catalog products; this rate only applies if you list USA items in international products.',
            'Définissez le tarif d\'expédition par kg pour chaque pays d\'origine. Les USA utilisent les frais existants pour les produits du catalogue ; ce tarif ne s\'applique qu\'aux produits internationaux USA.',
          )}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <Card key={r.country}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <span className="text-3xl">{r.flag_emoji}</span>
                  <span>{isFr ? r.label_fr : r.label_en}</span>
                </CardTitle>
                <CardDescription>{r.country.toUpperCase()}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-2">
                  <Label>{t('Rate per kg (USD)', 'Tarif par kg (USD)')}</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={r.rate_per_kg_usd}
                    onChange={(e) => updateLocal(r.country, { rate_per_kg_usd: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('Enabled', 'Activé')}</Label>
                  <div className="h-10 flex items-center">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(v) => updateLocal(r.country, { enabled: v })}
                    />
                  </div>
                </div>
                <Button onClick={() => save(r)} disabled={savingKey === r.country}>
                  {savingKey === r.country
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Save className="h-4 w-4 mr-2" />}
                  {t('Save', 'Enregistrer')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
