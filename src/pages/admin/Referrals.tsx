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
import { Gift, Check, Users, MousePointerClick, UserCheck, Loader2, Plus, Pencil, DollarSign, Settings } from 'lucide-react';

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
  referrer_name?: string;
}

interface PayoutRule {
  id: string;
  threshold_verified_count: number;
  payout_amount_usd: number;
  is_enabled: boolean;
}

export default function AdminReferrals() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [referrers, setReferrers] = useState<Referrer[]>([]);
  const [claims, setClaims] = useState<PayoutClaim[]>([]);
  const [rules, setRules] = useState<PayoutRule[]>([]);
  const [stats, setStats] = useState({ clicks: 0, signups: 0, verified: 0, pendingClaims: 0 });
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState('');
  const [ruleDialog, setRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<PayoutRule | null>(null);
  const [ruleForm, setRuleForm] = useState({ threshold: 10, amount: 5 });
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
          .select('id, full_name')
          .in('id', referrerIds.length ? referrerIds : ['none']);

        const refMap = new Map(refs?.map(r => [r.id, r.full_name]) || []);
        setClaims(claimsData.map(c => ({ ...c, referrer_name: refMap.get(c.referrer_id) || c.ref_code })));
      }

      // Load rules
      const { data: rulesData } = await supabase
        .from('referral_payout_rules')
        .select('*')
        .order('threshold_verified_count', { ascending: true });
      if (rulesData) setRules(rulesData);

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

  const saveRule = async () => {
    if (editingRule) {
      await supabase.from('referral_payout_rules').update({
        threshold_verified_count: ruleForm.threshold,
        payout_amount_usd: ruleForm.amount,
      }).eq('id', editingRule.id);
    } else {
      await supabase.from('referral_payout_rules').insert({
        threshold_verified_count: ruleForm.threshold,
        payout_amount_usd: ruleForm.amount,
      });
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
                      <TableHead>{isFr ? 'Montant' : 'Amount'}</TableHead>
                      <TableHead>Status</TableHead>
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
                        <TableCell className="text-sm text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {c.status === 'pending' && (
                            <Button size="sm" variant="outline" onClick={() => markClaimPaid(c.id)}>
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

        {/* Rules & Config Tab */}
        <TabsContent value="rules" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{isFr ? 'Règles de paiement' : 'Payout Rules'}</CardTitle>
              <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" onClick={() => { setEditingRule(null); setRuleForm({ threshold: 10, amount: 5 }); }}>
                    <Plus className="h-4 w-4 mr-1" />{isFr ? 'Ajouter' : 'Add Rule'}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingRule ? (isFr ? 'Modifier la règle' : 'Edit Rule') : (isFr ? 'Nouvelle règle' : 'New Rule')}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div>
                      <Label>{isFr ? 'Seuil (inscriptions vérifiées)' : 'Threshold (verified signups)'}</Label>
                      <Input type="number" min={1} value={ruleForm.threshold} onChange={e => setRuleForm(f => ({ ...f, threshold: parseInt(e.target.value) || 1 }))} />
                    </div>
                    <div>
                      <Label>{isFr ? 'Montant ($)' : 'Amount ($)'}</Label>
                      <Input type="number" min={0} step={0.5} value={ruleForm.amount} onChange={e => setRuleForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} />
                    </div>
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
                      <TableHead>{isFr ? 'Montant' : 'Amount'}</TableHead>
                      <TableHead>{isFr ? 'Actif' : 'Enabled'}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>{r.threshold_verified_count} {isFr ? 'vérifiés' : 'verified'}</TableCell>
                        <TableCell className="font-bold">${r.payout_amount_usd}</TableCell>
                        <TableCell><Switch checked={r.is_enabled} onCheckedChange={v => toggleRule(r.id, v)} /></TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => { setEditingRule(r); setRuleForm({ threshold: r.threshold_verified_count, amount: r.payout_amount_usd }); setRuleDialog(true); }}>
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
