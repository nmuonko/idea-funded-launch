import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Users, MousePointerClick, ShoppingCart, DollarSign, Loader2, Percent, Send, History, Zap, UserPlus } from 'lucide-react';

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
  pending_commission?: number;
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

interface Payout {
  id: string;
  referrer_id: string;
  amount_usd: number;
  phone: string;
  correspondent: string;
  pawapay_payout_id: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  failure_reason: string | null;
  referrer_name?: string;
}

interface ReferredUser {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  referred_by_code: string;
  referrer_name: string;
  created_at: string;
  has_purchased: boolean;
  signup_platform: string;
}

export default function AdminReferrals() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [referrers, setReferrers] = useState<Referrer[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [referredUsers, setReferredUsers] = useState<ReferredUser[]>([]);
  const [stats, setStats] = useState({ clicks: 0, signups: 0, purchases: 0, pendingCommissions: 0, totalReferredSignups: 0 });
  const [loading, setLoading] = useState(true);
  const [commissionPercent, setCommissionPercent] = useState('10');
  const [payoutMode, setPayoutMode] = useState<'automatic' | 'manual'>('manual');
  const [minPayoutUsd, setMinPayoutUsd] = useState('5');
  const [savingSettings, setSavingSettings] = useState(false);
  const [payingOut, setPayingOut] = useState<string | null>(null);
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
            .select('commission_amount_usd, status')
            .eq('referrer_id', r.id);
          
          enriched.push({
            ...r,
            purchase_count: commData?.length || 0,
            total_commission: commData?.reduce((sum, c) => sum + (c.commission_amount_usd || 0), 0) || 0,
            pending_commission: commData?.filter(c => c.status === 'pending').reduce((sum, c) => sum + (c.commission_amount_usd || 0), 0) || 0,
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

      // Load payouts
      const { data: payoutData } = await supabase
        .from('referral_payouts')
        .select('*')
        .order('created_at', { ascending: false });

      if (payoutData) {
        const referrerIds = [...new Set(payoutData.map((p: any) => p.referrer_id))];
        const { data: refs } = await supabase
          .from('referrers')
          .select('id, full_name')
          .in('id', referrerIds.length ? referrerIds : ['none']);
        const refMap = new Map(refs?.map(r => [r.id, r.full_name]) || []);
        setPayouts((payoutData as any[]).map(p => ({
          ...p,
          referrer_name: refMap.get(p.referrer_id) || 'Unknown',
        })));
      }

      // Load settings
      const { data: settings } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', ['REFERRAL_COMMISSION_PERCENT', 'REFERRAL_PAYOUT_MODE', 'REFERRAL_PAYOUT_MIN_USD']);

      if (settings) {
        for (const s of settings) {
          if (s.key === 'REFERRAL_COMMISSION_PERCENT') setCommissionPercent(s.value);
          if (s.key === 'REFERRAL_PAYOUT_MODE') setPayoutMode(s.value as 'automatic' | 'manual');
          if (s.key === 'REFERRAL_PAYOUT_MIN_USD') setMinPayoutUsd(s.value);
        }
      }

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

      // Count total referred signups from profiles
      const { count: totalReferredCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .not('referred_by_code', 'is', null);

      // Load referred users with details
      const { data: referredProfiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, phone, referred_by_code, created_at, signup_platform')
        .not('referred_by_code', 'is', null)
        .order('created_at', { ascending: false });

      if (referredProfiles) {
        // Map ref codes to referrer names
        const refCodes = [...new Set(referredProfiles.map(p => p.referred_by_code).filter(Boolean))];
        const { data: codeRefs } = await supabase
          .from('referrers')
          .select('ref_code, full_name')
          .in('ref_code', refCodes.length ? refCodes : ['none']);
        const codeMap = new Map(codeRefs?.map(r => [r.ref_code, r.full_name]) || []);

        // Check which referred users have purchased
        const referredUserIds = referredProfiles.map(p => p.user_id);
        const { data: buyerCommissions } = await supabase
          .from('referral_commissions')
          .select('buyer_user_id')
          .in('buyer_user_id', referredUserIds.length ? referredUserIds : ['none']);
        const buyerSet = new Set(buyerCommissions?.map(c => c.buyer_user_id) || []);

        setReferredUsers(referredProfiles.map(p => ({
          user_id: p.user_id,
          full_name: p.full_name || '',
          email: p.email || '',
          phone: p.phone || '',
          referred_by_code: p.referred_by_code || '',
          referrer_name: codeMap.get(p.referred_by_code || '') || isFr ? 'Inconnu' : 'Unknown',
          created_at: p.created_at,
          has_purchased: buyerSet.has(p.user_id),
          signup_platform: p.signup_platform || 'web',
        })));
      }

      setStats({
        clicks: clickCount || 0,
        signups: signupCount || 0,
        purchases: purchaseCount,
        pendingCommissions: Math.round(pendingAmount * 100) / 100,
        totalReferredSignups: totalReferredCount || 0,
      });
    } catch (err) {
      console.error('Error loading referral data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await supabase.from('admin_settings').upsert(
        { key: 'REFERRAL_COMMISSION_PERCENT', value: commissionPercent },
        { onConflict: 'key' }
      );
      await supabase.from('admin_settings').upsert(
        { key: 'REFERRAL_PAYOUT_MODE', value: payoutMode },
        { onConflict: 'key' }
      );
      await supabase.from('admin_settings').upsert(
        { key: 'REFERRAL_PAYOUT_MIN_USD', value: minPayoutUsd },
        { onConflict: 'key' }
      );
      toast({ title: isFr ? 'Paramètres sauvegardés' : 'Settings saved' });
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setSavingSettings(false);
    }
  };

  const triggerPayout = async (referrerId: string) => {
    setPayingOut(referrerId);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/referral-payout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ action: 'process', referrer_id: referrerId }),
        }
      );
      const result = await res.json();

      if (result.success) {
        toast({ title: isFr ? 'Paiement envoyé !' : 'Payout sent!' });
        loadData();
      } else {
        toast({ title: result.message || 'Error', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' });
    } finally {
      setPayingOut(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      paid: 'default',
      completed: 'default',
      sent: 'outline',
      pending: 'secondary',
      processing: 'outline',
      failed: 'destructive',
    };
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{isFr ? 'Parrainages & Commissions' : 'Referrals & Commissions'}</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { icon: MousePointerClick, color: 'text-blue-500', value: stats.clicks, label: isFr ? 'Clics' : 'Clicks' },
          { icon: UserPlus, color: 'text-purple-500', value: stats.totalReferredSignups, label: isFr ? 'Inscrits via parrainage' : 'Referred Signups' },
          { icon: Users, color: 'text-orange-500', value: stats.signups, label: isFr ? 'Événements inscription' : 'Signup Events' },
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
          <TabsTrigger value="referred">{isFr ? 'Utilisateurs parrainés' : 'Referred Users'}</TabsTrigger>
          <TabsTrigger value="commissions">{isFr ? 'Commissions' : 'Commissions'}</TabsTrigger>
          <TabsTrigger value="payouts">{isFr ? 'Paiements' : 'Payouts'}</TabsTrigger>
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
                      <TableHead>{isFr ? 'En attente' : 'Pending'}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
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
                        <TableCell className="font-bold text-yellow-600">${(r.pending_commission || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'active' ? 'default' : 'destructive'}>{r.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {(r.pending_commission || 0) >= parseFloat(minPayoutUsd) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => triggerPayout(r.id)}
                              disabled={payingOut === r.id}
                            >
                              {payingOut === r.id ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <Send className="h-3 w-3 mr-1" />
                              )}
                              {isFr ? 'Payer' : 'Pay Now'}
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

        {/* Referred Users Tab */}
        <TabsContent value="referred">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                {isFr ? 'Utilisateurs inscrits via parrainage' : 'Users Signed Up via Referral'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : referredUsers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{isFr ? 'Aucun utilisateur parrainé' : 'No referred users yet'}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isFr ? 'Nom' : 'Name'}</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>{isFr ? 'Téléphone' : 'Phone'}</TableHead>
                      <TableHead>{isFr ? 'Code du parrain' : 'Referrer Code'}</TableHead>
                      <TableHead>{isFr ? 'Parrain' : 'Referrer'}</TableHead>
                      <TableHead>{isFr ? 'Plateforme' : 'Platform'}</TableHead>
                      <TableHead>{isFr ? 'A acheté ?' : 'Purchased?'}</TableHead>
                      <TableHead>{isFr ? 'Inscription' : 'Signed Up'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referredUsers.map(u => (
                      <TableRow key={u.user_id}>
                        <TableCell className="font-medium">{u.full_name || '-'}</TableCell>
                        <TableCell className="text-sm">{u.email || '-'}</TableCell>
                        <TableCell className="text-sm">{u.phone || '-'}</TableCell>
                        <TableCell><code className="text-xs">{u.referred_by_code}</code></TableCell>
                        <TableCell className="font-medium">{u.referrer_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{u.signup_platform === 'mobile' ? '📱 App' : '🌐 Web'}</Badge>
                        </TableCell>
                        <TableCell>
                          {u.has_purchased ? (
                            <Badge variant="default" className="bg-emerald-600">✅ {isFr ? 'Oui' : 'Yes'}</Badge>
                          ) : (
                            <Badge variant="secondary">{isFr ? 'Pas encore' : 'Not yet'}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
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
                        <TableCell>{getStatusBadge(c.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payouts Tab */}
        <TabsContent value="payouts">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                {isFr ? 'Historique des paiements' : 'Payout History'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {payouts.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{isFr ? 'Aucun paiement' : 'No payouts yet'}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isFr ? 'Parrain' : 'Referrer'}</TableHead>
                      <TableHead>{isFr ? 'Montant' : 'Amount'}</TableHead>
                      <TableHead>{isFr ? 'Téléphone' : 'Phone'}</TableHead>
                      <TableHead>{isFr ? 'Opérateur' : 'Operator'}</TableHead>
                      <TableHead>PawaPay ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>{isFr ? 'Erreur' : 'Error'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.referrer_name}</TableCell>
                        <TableCell className="font-bold text-green-600">${p.amount_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-sm">{p.phone}</TableCell>
                        <TableCell className="text-sm">{p.correspondent}</TableCell>
                        <TableCell className="text-xs font-mono">{p.pawapay_payout_id?.slice(0, 8) || '-'}...</TableCell>
                        <TableCell>{getStatusBadge(p.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-xs text-destructive">{p.failure_reason || '-'}</TableCell>
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
          <div className="space-y-6">
            {/* Commission Percentage */}
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
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  {isFr
                    ? 'Ce pourcentage sera appliqué sur chaque achat effectué via un lien de parrainage.'
                    : 'This percentage will be applied to every purchase made through a referral link.'}
                </p>
              </CardContent>
            </Card>

            {/* Payout Mode */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  {isFr ? 'Mode de paiement' : 'Payout Mode'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between max-w-sm">
                  <div>
                    <Label className="font-medium">
                      {payoutMode === 'automatic'
                        ? (isFr ? 'Automatique' : 'Automatic')
                        : (isFr ? 'Approbation manuelle' : 'One-Click Approval')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {payoutMode === 'automatic'
                        ? (isFr ? 'Les paiements sont envoyés automatiquement via Mobile Money' : 'Payouts are sent automatically via Mobile Money')
                        : (isFr ? 'Vous approuvez chaque paiement manuellement' : 'You approve each payout manually')}
                    </p>
                  </div>
                  <Switch
                    checked={payoutMode === 'automatic'}
                    onCheckedChange={(checked) => setPayoutMode(checked ? 'automatic' : 'manual')}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Minimum Payout */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  {isFr ? 'Paiement minimum' : 'Minimum Payout'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 max-w-sm">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={minPayoutUsd}
                      onChange={e => setMinPayoutUsd(e.target.value)}
                      className="pl-7"
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  {isFr
                    ? 'Les paiements ne seront envoyés que lorsque le solde du parrain atteindra ce montant minimum.'
                    : 'Payouts will only be sent when the referrer\'s balance reaches this minimum amount.'}
                </p>
              </CardContent>
            </Card>

            <Button onClick={saveSettings} disabled={savingSettings} className="w-full max-w-sm">
              {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isFr ? 'Sauvegarder les paramètres' : 'Save Settings'}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
