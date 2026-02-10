import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Gift, Check, Users, MousePointerClick, UserCheck, Loader2 } from 'lucide-react';

interface ReferralReward {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  ref_code: string;
  amount_usd: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  referrer_name?: string;
  referred_name?: string;
}

export default function AdminReferrals() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [stats, setStats] = useState({ clicks: 0, signups: 0, verified: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const isFr = language === 'fr';

  const loadData = async () => {
    setLoading(true);
    try {
      // Load rewards
      const { data: rewardsData } = await supabase
        .from('referral_rewards')
        .select('*')
        .order('created_at', { ascending: false });

      if (rewardsData) {
        // Enrich with profile names
        const userIds = [...new Set(rewardsData.flatMap(r => [r.referrer_user_id, r.referred_user_id]))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', userIds);

        const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
        
        const enriched = rewardsData.map(r => ({
          ...r,
          referrer_name: profileMap.get(r.referrer_user_id)?.full_name || profileMap.get(r.referrer_user_id)?.email || r.referrer_user_id.slice(0, 8),
          referred_name: profileMap.get(r.referred_user_id)?.full_name || profileMap.get(r.referred_user_id)?.email || r.referred_user_id.slice(0, 8),
        }));
        setRewards(enriched);
      }

      // Load stats from referral_events
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
        .eq('event_type', 'email_verified');

      const pendingCount = rewardsData?.filter(r => r.status === 'pending').length || 0;

      setStats({
        clicks: clickCount || 0,
        signups: signupCount || 0,
        verified: verifiedCount || 0,
        pending: pendingCount,
      });
    } catch (err) {
      console.error('Error loading referral data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const markPaid = async (rewardId: string) => {
    const { error } = await supabase
      .from('referral_rewards')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', rewardId);
    
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: isFr ? 'Marqué payé' : 'Marked as paid' });
      loadData();
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{isFr ? 'Parrainages & Récompenses' : 'Referrals & Rewards'}</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <MousePointerClick className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{stats.clicks}</p>
              <p className="text-sm text-muted-foreground">{isFr ? 'Clics' : 'Clicks'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Users className="h-8 w-8 text-orange-500" />
            <div>
              <p className="text-2xl font-bold">{stats.signups}</p>
              <p className="text-sm text-muted-foreground">{isFr ? 'Inscriptions' : 'Signups'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <UserCheck className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{stats.verified}</p>
              <p className="text-sm text-muted-foreground">{isFr ? 'Vérifiés' : 'Verified'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Gift className="h-8 w-8 text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-sm text-muted-foreground">{isFr ? 'En attente' : 'Pending'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rewards Table */}
      <Card>
        <CardHeader>
          <CardTitle>{isFr ? 'Récompenses' : 'Rewards'}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : rewards.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {isFr ? 'Aucune récompense pour le moment' : 'No rewards yet'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isFr ? 'Parrain' : 'Referrer'}</TableHead>
                  <TableHead>{isFr ? 'Filleul' : 'Referred'}</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewards.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.referrer_name}</TableCell>
                    <TableCell>{r.referred_name}</TableCell>
                    <TableCell><code className="text-xs">{r.ref_code}</code></TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'paid' ? 'default' : r.status === 'pending' ? 'secondary' : 'destructive'}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {r.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => markPaid(r.id)}>
                          <Check className="h-3 w-3 mr-1" />
                          {isFr ? 'Marquer payé' : 'Mark Paid'}
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
    </div>
  );
}
