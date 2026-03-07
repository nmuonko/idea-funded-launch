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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gift, Check, Users, MousePointerClick, UserCheck, Loader2, Plus, Pencil, DollarSign, Settings, RefreshCw, Wifi, Phone } from 'lucide-react';

interface Referrer {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  ref_code: string;
  status: string;
  created_at: string;
  verified_count?: number;
}

interface PayoutClaim {
  id: string;
  referrer_id: string;
  ref_code: string;
  rule_id: string;
  verified_count_at_trigger: number;
  payout_amount_usd: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  delivery_status: string | null;
  delivery_tx_id: string | null;
  delivery_error: string | null;
  referrer_name?: string;
  referrer_phone?: string;
}

interface PayoutRule {
  id: string;
  threshold_verified_count: number;
  payout_amount_usd: number;
  is_enabled: boolean;
  reward_type: string;
  data_mb: number | null;
  airtime_amount: number | null;
  operator_country_code: string;
}

export default function AdminReferrals() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [referrers, setReferrers] = useState<Referrer[]>([]);
  const [claims, setClaims] = useState<PayoutClaim[]>([]);
  const [rules, setRules] = useState<PayoutRule[]>([]);
  const [stats, setStats] = useState({ clicks: 0, signups: 0, verified: 0, pendingClaims: 0 });
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [ruleDialog, setRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<PayoutRule | null>(null);
  const [ruleForm, setRuleForm] = useState({
    threshold: 10,
    amount: 5,
    reward_type: 'cash' as string,
    data_mb: 100,
    airtime_amount: 0,
    operator_country_code: 'CD',
  });
  const isFr = language === 'fr';

  const loadData = async () => {
    setLoading(true);
    try {
      // Load referrers
      const { data: refData } = await supabase
        .from('referrers')
        .select('*')
        .order('created_at', { ascending: false });

      if (refData) {
        const enriched: Referrer[] = [];
        for (const r of refData) {
          const { count } = await supabase
            .from('referral_rewards')
            .select('*', { count: 'exact', head: true })
            .eq('ref_code', r.ref_code);
          enriched.push({ ...r, verified_count: count || 0 });
        }
        setReferrers(enriched);
      }

      // Load payout claims
      const { data: claimsData } = await supabase
        .from('referral_payout_claims')
        .select('*')
        .order('created_at', { ascending: false });

      if (claimsData) {
        const referrerIds = [...new Set(claimsData.map(c => c.referrer_id))];
        const { data: refs } = await supabase
          .from('referrers')
          .select('id, full_name, phone')
          .in('id', referrerIds.length ? referrerIds : ['none']);

        const refMap = new Map(refs?.map(r => [r.id, { name: r.full_name, phone: r.phone }]) || []);
        setClaims(claimsData.map(c => ({
          ...c,
          referrer_name: refMap.get(c.referrer_id)?.name || c.ref_code,
          referrer_phone: refMap.get(c.referrer_id)?.phone || '',
        })));
      }

      // Load rules
      const { data: rulesData } = await supabase
        .from('referral_payout_rules')
        .select('*')
        .order('threshold_verified_count', { ascending: true });
      if (rulesData) setRules(rulesData as PayoutRule[]);

      // Load admin email
      const { data: emailSetting } = await supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'ADMIN_ALERT_EMAIL')
        .maybeSingle();
      if (emailSetting) setAdminEmail(emailSetting.value);

      // Stats
      const { count: clickCount } = await supabase
        .from('referral_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'click');
      const { count: signupCount } = await supabase
        .from('referral_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'signup');
      const { count: verifiedCount } = await supabase
        .from('referral_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'verified');
      const pendingClaims = claimsData?.filter(c => c.status === 'pending').length || 0;

      setStats({ clicks: clickCount || 0, signups: signupCount || 0, verified: verifiedCount || 0, pendingClaims });
    } catch (err) {
      console.error('Error loading referral data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const markClaimPaid = async (id: string) => {
    await supabase.from('referral_payout_claims').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', id);
    toast({ title: isFr ? 'Marqué payé' : 'Marked as paid' });
    loadData();
  };

  const retryDelivery = async (claim: PayoutClaim) => {
    setRetrying(claim.id);
    try {
      // Find the rule to get reward details
      const rule = rules.find(r => r.id === claim.rule_id);
      if (!rule) {
        toast({ title: isFr ? 'Règle introuvable' : 'Rule not found', variant: 'destructive' });
        return;
      }

      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: {
          action: 'reloadly_topup',
          phone: claim.referrer_phone,
          countryCode: rule.operator_country_code || 'CD',
          topupType: rule.reward_type,
          amount: rule.reward_type === 'airtime' ? rule.airtime_amount : rule.data_mb,
          dataMb: rule.reward_type === 'data' ? rule.data_mb : null,
          claimId: claim.id,
          referrerId: claim.referrer_id,
        },
      });

      if (error) throw error;
      if (data?.ok) {
        toast({ title: isFr ? 'Livraison réussie!' : 'Delivery successful!' });
      } else {
        toast({ title: isFr ? 'Échec de livraison' : 'Delivery failed', description: data?.message, variant: 'destructive' });
      }
      loadData();
    } catch (err: any) {
      toast({ title: isFr ? 'Erreur' : 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setRetrying(null);
    }
  };

  const saveRule = async () => {
    const payload: Record<string, unknown> = {
      threshold_verified_count: ruleForm.threshold,
      payout_amount_usd: ruleForm.amount,
      reward_type: ruleForm.reward_type,
      data_mb: ruleForm.reward_type === 'data' ? ruleForm.data_mb : null,
      airtime_amount: ruleForm.reward_type === 'airtime' ? ruleForm.airtime_amount : null,
      operator_country_code: ruleForm.operator_country_code,
    };

    if (editingRule) {
      await supabase.from('referral_payout_rules').update(payload as any).eq('id', editingRule.id);
    } else {
      await supabase.from('referral_payout_rules').insert(payload as any);
    }
    toast({ title: isFr ? 'Sauvegardé' : 'Saved' });
    setRuleDialog(false);
    setEditingRule(null);
    loadData();
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await supabase.from('referral_payout_rules').update({ is_enabled: enabled }).eq('id', id);
    loadData();
  };

  const saveAdminEmail = async () => {
    await supabase.from('admin_settings').upsert({ key: 'ADMIN_ALERT_EMAIL', value: adminEmail }, { onConflict: 'key' });
    toast({ title: isFr ? 'Email admin sauvegardé' : 'Admin email saved' });
  };

  const getRewardLabel = (rule: PayoutRule) => {
    switch (rule.reward_type) {
      case 'data': return `${rule.data_mb || 0}MB`;
      case 'airtime': return `${rule.airtime_amount || 0} airtime`;
      default: return `$${rule.payout_amount_usd}`;
    }
  };

  const getRewardIcon = (type: string) => {
    switch (type) {
      case 'data': return <Wifi className="h-4 w-4" />;
      case 'airtime': return <Phone className="h-4 w-4" />;
      default: return <DollarSign className="h-4 w-4" />;
    }
  };

  const getDeliveryBadge = (status: string | null) => {
    switch (status) {
      case 'delivered': return <Badge className="bg-green-600">Delivered</Badge>;
      case 'delivery_failed': return <Badge variant="destructive">Failed</Badge>;
      case 'pending': return <Badge variant="secondary">Pending</Badge>;
      default: return null;
    }
  };

  const openRuleDialog = (rule?: PayoutRule) => {
    if (rule) {
      setEditingRule(rule);
      setRuleForm({
        threshold: rule.threshold_verified_count,
        amount: rule.payout_amount_usd,
        reward_type: rule.reward_type || 'cash',
        data_mb: rule.data_mb || 100,
        airtime_amount: rule.airtime_amount || 0,
        operator_country_code: rule.operator_country_code || 'CD',
      });
    } else {
      setEditingRule(null);
      setRuleForm({ threshold: 10, amount: 5, reward_type: 'cash', data_mb: 100, airtime_amount: 0, operator_country_code: 'CD' });
    }
    setRuleDialog(true);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{isFr ? 'Parrainages & Paiements' : 'Referrals & Payouts'}</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: MousePointerClick, color: 'text-blue-500', value: stats.clicks, label: isFr ? 'Clics' : 'Clicks' },
          { icon: Users, color: 'text-orange-500', value: stats.signups, label: isFr ? 'Inscriptions' : 'Signups' },
          { icon: UserCheck, color: 'text-green-500', value: stats.verified, label: isFr ? 'Vérifiés' : 'Verified' },
          { icon: DollarSign, color: 'text-yellow-500', value: stats.pendingClaims, label: isFr ? 'Paiements en attente' : 'Pending Payouts' },
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
          <TabsTrigger value="claims">{isFr ? 'Paiements' : 'Payouts'}</TabsTrigger>
          <TabsTrigger value="rules">{isFr ? 'Règles & Config' : 'Rules & Config'}</TabsTrigger>
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
                      <TableHead>{isFr ? 'Vérifiés' : 'Verified'}</TableHead>
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
                        <TableCell className="font-bold">{r.verified_count || 0}</TableCell>
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

        {/* Payout Claims Tab */}
        <TabsContent value="claims">
          <Card>
            <CardHeader><CardTitle>{isFr ? 'Demandes de paiement' : 'Payout Claims'}</CardTitle></CardHeader>
            <CardContent>
              {claims.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{isFr ? 'Aucune demande' : 'No claims yet'}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isFr ? 'Parrain' : 'Referrer'}</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>{isFr ? 'Vérifiés' : 'Verified'}</TableHead>
                      <TableHead>{isFr ? 'Récompense' : 'Reward'}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>{isFr ? 'Livraison' : 'Delivery'}</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.referrer_name}</TableCell>
                        <TableCell><code className="text-xs">{c.ref_code}</code></TableCell>
                        <TableCell>{c.verified_count_at_trigger}</TableCell>
                        <TableCell className="font-bold">${c.payout_amount_usd}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'paid' ? 'default' : 'secondary'}>{c.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {getDeliveryBadge(c.delivery_status)}
                            {c.delivery_tx_id && <span className="text-xs text-muted-foreground">TX: {c.delivery_tx_id.slice(0, 8)}...</span>}
                            {c.delivery_error && <span className="text-xs text-destructive">{c.delivery_error}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {c.status === 'pending' && !c.delivery_status && (
                              <Button size="sm" variant="outline" onClick={() => markClaimPaid(c.id)}>
                                <Check className="h-3 w-3 mr-1" />{isFr ? 'Payé' : 'Mark Paid'}
                              </Button>
                            )}
                            {c.delivery_status === 'delivery_failed' && (
                              <Button size="sm" variant="outline" onClick={() => retryDelivery(c)} disabled={retrying === c.id}>
                                {retrying === c.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                                {isFr ? 'Réessayer' : 'Retry'}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rules & Config Tab */}
        <TabsContent value="rules" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{isFr ? 'Règles de paiement' : 'Payout Rules'}</CardTitle>
              <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" onClick={() => openRuleDialog()}>
                    <Plus className="h-4 w-4 mr-1" />{isFr ? 'Ajouter' : 'Add Rule'}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingRule ? (isFr ? 'Modifier la règle' : 'Edit Rule') : (isFr ? 'Nouvelle règle' : 'New Rule')}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div>
                      <Label>{isFr ? 'Type de récompense' : 'Reward Type'}</Label>
                      <Select value={ruleForm.reward_type} onValueChange={v => setRuleForm(f => ({ ...f, reward_type: v }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">{isFr ? 'Argent ($)' : 'Cash ($)'}</SelectItem>
                          <SelectItem value="data">{isFr ? 'Données mobiles (MB)' : 'Mobile Data (MB)'}</SelectItem>
                          <SelectItem value="airtime">{isFr ? 'Crédit téléphone' : 'Airtime'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{isFr ? 'Seuil (inscriptions vérifiées)' : 'Threshold (verified signups)'}</Label>
                      <Input type="number" min={1} value={ruleForm.threshold} onChange={e => setRuleForm(f => ({ ...f, threshold: parseInt(e.target.value) || 1 }))} />
                    </div>

                    {ruleForm.reward_type === 'cash' && (
                      <div>
                        <Label>{isFr ? 'Montant ($)' : 'Amount ($)'}</Label>
                        <Input type="number" min={0} step={0.5} value={ruleForm.amount} onChange={e => setRuleForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} />
                      </div>
                    )}

                    {ruleForm.reward_type === 'data' && (
                      <div>
                        <Label>{isFr ? 'Données (MB)' : 'Data (MB)'}</Label>
                        <Input type="number" min={1} value={ruleForm.data_mb} onChange={e => setRuleForm(f => ({ ...f, data_mb: parseInt(e.target.value) || 100 }))} />
                      </div>
                    )}

                    {ruleForm.reward_type === 'airtime' && (
                      <div>
                        <Label>{isFr ? 'Montant crédit (monnaie locale)' : 'Airtime Amount (local currency)'}</Label>
                        <Input type="number" min={0} step={100} value={ruleForm.airtime_amount} onChange={e => setRuleForm(f => ({ ...f, airtime_amount: parseFloat(e.target.value) || 0 }))} />
                      </div>
                    )}

                    {(ruleForm.reward_type === 'data' || ruleForm.reward_type === 'airtime') && (
                      <div>
                        <Label>{isFr ? 'Code pays opérateur' : 'Operator Country Code'}</Label>
                        <Input value={ruleForm.operator_country_code} onChange={e => setRuleForm(f => ({ ...f, operator_country_code: e.target.value.toUpperCase() }))} placeholder="CD" maxLength={2} />
                        <p className="text-xs text-muted-foreground mt-1">
                          {isFr ? 'Ex: CD = RD Congo, KE = Kenya' : 'E.g. CD = DR Congo, KE = Kenya'}
                        </p>
                      </div>
                    )}

                    <Button onClick={saveRule} className="w-full">{isFr ? 'Sauvegarder' : 'Save'}</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">{isFr ? 'Aucune règle' : 'No rules'}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isFr ? 'Seuil' : 'Threshold'}</TableHead>
                      <TableHead>{isFr ? 'Type' : 'Type'}</TableHead>
                      <TableHead>{isFr ? 'Récompense' : 'Reward'}</TableHead>
                      <TableHead>{isFr ? 'Actif' : 'Enabled'}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>{r.threshold_verified_count} {isFr ? 'vérifiés' : 'verified'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {getRewardIcon(r.reward_type || 'cash')}
                            <span className="capitalize">{r.reward_type || 'cash'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-bold">{getRewardLabel(r)}</TableCell>
                        <TableCell><Switch checked={r.is_enabled} onCheckedChange={v => toggleRule(r.id, v)} /></TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => openRuleDialog(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />{isFr ? 'Email admin pour alertes' : 'Admin Alert Email'}</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@example.com" className="flex-1" />
                <Button onClick={saveAdminEmail}>{isFr ? 'Sauvegarder' : 'Save'}</Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {isFr ? 'Cet email recevra des alertes quand un parrain atteint un seuil de paiement.' : 'This email will receive alerts when a referrer reaches a payout threshold.'}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
