import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Users, MousePointerClick, ShoppingCart, DollarSign, Loader2, Check, Percent } from 'lucide-react';

interface Referrer {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  ref_code: string;
  status: string;
  created_at: string;
  purchase_count?: number;
  total_commission?: number;
}

interface Commission {
  id: string;
  referrer_id: string;
  order_id: string;
  buyer_user_id: string;
  order_total_usd: number;
  commission_percent: number;
  commission_amount_usd: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  referrer_name?: string;
  referrer_code?: string;
}

export default function AdminReferrals() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [referrers, setReferrers] = useState<Referrer[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [stats, setStats] = useState({ clicks: 0, signups: 0, purchases: 0, pendingCommissions: 0 });
  const [loading, setLoading] = useState(true);
  const [commissionPercent, setCommissionPercent] = useState('10');
  const [savingPercent, setSavingPercent] = useState(false);
  const isFr = language === 'fr';

  const loadData = async () => {
    setLoading(true);
    try {
      // Load referrers with commission stats
      const { data: refData } = await supabase
        .from('referrers')
        .select('*')
        .order('created_at', { ascending: false });

      if (refData) {
        const enriched: Referrer[] = [];
        for (const r of refData) {
          const { data: commData } = await supabase
            .from('referral_commissions')
            .select('commission_amount_usd')
            .eq('referrer_id', r.id);
          
          enriched.push({
            ...r,
            purchase_count: commData?.length || 0,
            total_commission: commData?.reduce((sum, c) => sum + (c.commission_amount_usd || 0), 0) || 0,
          });
        }
        setReferrers(enriched);
      }

      // Load commissions
      const { data: commData } = await supabase
        .from('referral_commissions')
        .select('*')
        .order('created_at', { ascending: false });

      if (commData) {
        const referrerIds = [...new Set(commData.map(c => c.referrer_id))];
        const { data: refs } = await supabase
          .from('referrers')
          .select('id, full_name, ref_code')
          .in('id', referrerIds.length ? referrerIds : ['none']);

        const refMap = new Map(refs?.map(r => [r.id, { name: r.full_name, code: r.ref_code }]) || []);
        setCommissions(commData.map(c => ({
          ...c,
          referrer_name: refMap.get(c.referrer_id)?.name || 'Unknown',
          referrer_code: refMap.get(c.referrer_id)?.code || '',
        })));
      }

      // Load commission percent setting
      const { data: setting } = await supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'REFERRAL_COMMISSION_PERCENT')
        .maybeSingle();
      if (setting) setCommissionPercent(setting.value);

      // Stats
      const { count: clickCount } = await supabase
        .from('referral_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'click');
      const { count: signupCount } = await supabase
        .from('referral_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'signup');
      const purchaseCount = commData?.length || 0;
      const pendingAmount = commData
        ?.filter(c => c.status === 'pending')
        .reduce((sum, c) => sum + (c.commission_amount_usd || 0), 0) || 0;

      setStats({
        clicks: clickCount || 0,
        signups: signupCount || 0,
        purchases: purchaseCount,
        pendingCommissions: Math.round(pendingAmount * 100) / 100,
      });
    } catch (err) {
      console.error('Error loading referral data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const saveCommissionPercent = async () => {
    setSavingPercent(true);
    try {
      await supabase.from('admin_settings').upsert(
        { key: 'REFERRAL_COMMISSION_PERCENT', value: commissionPercent },
        { onConflict: 'key' }
      );
      toast({ title: isFr ? 'Sauvegardé' : 'Saved' });
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setSavingPercent(false);
    }
  };

  const markCommissionPaid = async (id: string) => {
    await supabase.from('referral_commissions').update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    }).eq('id', id);
    toast({ title: isFr ? 'Marqué payé' : 'Marked as paid' });
    loadData();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{isFr ? 'Parrainages & Commissions' : 'Referrals & Commissions'}</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: MousePointerClick, color: 'text-blue-500', value: stats.clicks, label: isFr ? 'Clics' : 'Clicks' },
          { icon: Users, color: 'text-orange-500', value: stats.signups, label: isFr ? 'Inscriptions' : 'Signups' },
          { icon: ShoppingCart, color: 'text-green-500', value: stats.purchases, label: isFr ? 'Achats' : 'Purchases' },
          { icon: DollarSign, color: 'text-yellow-500', value: `$${stats.pendingCommissions}`, label: isFr ? 'Commissions en attente' : 'Pending Commissions' },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-8 w-8 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="referrers">
        <TabsList>
          <TabsTrigger value="referrers">{isFr ? 'Parrains' : 'Referrers'}</TabsTrigger>
          <TabsTrigger value="commissions">{isFr ? 'Commissions' : 'Commissions'}</TabsTrigger>
          <TabsTrigger value="settings">{isFr ? 'Paramètres' : 'Settings'}</TabsTrigger>
        </TabsList>

        {/* Referrers Tab */}
        <TabsContent value="referrers">
          <Card>
            <CardHeader><CardTitle>{isFr ? 'Parrains enregistrés' : 'Registered Referrers'}</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : referrers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{isFr ? 'Aucun parrain' : 'No referrers yet'}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isFr ? 'Nom' : 'Name'}</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>{isFr ? 'Téléphone' : 'Phone'}</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>{isFr ? 'Achats' : 'Purchases'}</TableHead>
                      <TableHead>{isFr ? 'Commission totale' : 'Total Commission'}</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrers.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.full_name}</TableCell>
                        <TableCell className="text-sm">{r.email}</TableCell>
                        <TableCell className="text-sm">{r.phone}</TableCell>
                        <TableCell><code className="text-xs">{r.ref_code}</code></TableCell>
                        <TableCell className="font-bold">{r.purchase_count || 0}</TableCell>
                        <TableCell className="font-bold text-green-600">${(r.total_commission || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'active' ? 'default' : 'destructive'}>{r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Commissions Tab */}
        <TabsContent value="commissions">
          <Card>
            <CardHeader><CardTitle>{isFr ? 'Commissions' : 'Commissions'}</CardTitle></CardHeader>
            <CardContent>
              {commissions.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{isFr ? 'Aucune commission' : 'No commissions yet'}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isFr ? 'Parrain' : 'Referrer'}</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>{isFr ? 'Commande' : 'Order'}</TableHead>
                      <TableHead>{isFr ? 'Total commande' : 'Order Total'}</TableHead>
                      <TableHead>%</TableHead>
                      <TableHead>{isFr ? 'Commission' : 'Commission'}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commissions.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.referrer_name}</TableCell>
                        <TableCell><code className="text-xs">{c.referrer_code}</code></TableCell>
                        <TableCell className="text-xs font-mono">{c.order_id.slice(0, 8)}...</TableCell>
                        <TableCell>${c.order_total_usd.toFixed(2)}</TableCell>
                        <TableCell>{c.commission_percent}%</TableCell>
                        <TableCell className="font-bold text-green-600">${c.commission_amount_usd.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'paid' ? 'default' : 'secondary'}>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {c.status === 'pending' && (
                            <Button size="sm" variant="outline" onClick={() => markCommissionPaid(c.id)}>
                              <Check className="h-3 w-3 mr-1" />{isFr ? 'Payé' : 'Mark Paid'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="h-5 w-5" />
                {isFr ? 'Pourcentage de commission' : 'Commission Percentage'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 max-w-sm">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={commissionPercent}
                    onChange={e => setCommissionPercent(e.target.value)}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                </div>
                <Button onClick={saveCommissionPercent} disabled={savingPercent}>
                  {savingPercent ? <Loader2 className="h-4 w-4 animate-spin" /> : (isFr ? 'Sauvegarder' : 'Save')}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                {isFr
                  ? 'Ce pourcentage sera appliqué sur chaque achat effectué via un lien de parrainage. Le parrain gagnera ce pourcentage du total de la commande.'
                  : 'This percentage will be applied to every purchase made through a referral link. The referrer will earn this percentage of the order total.'}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
