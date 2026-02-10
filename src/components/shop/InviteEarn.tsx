import { useState, useEffect } from 'react';
import { Gift, Copy, Check, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface InviteEarnProps {
  language: string;
}

const t = {
  en: {
    title: 'Invite & Earn',
    description: 'Share your link. Your friend signs up and verifies their email — you earn a reward!',
    copyLink: 'Copy Referral Link',
    copied: 'Copied!',
    stats: 'Your Referrals',
    pending: 'Pending',
    paid: 'Paid',
    signInRequired: 'Sign in to get your referral link',
  },
  fr: {
    title: 'Inviter & Gagner',
    description: 'Partagez votre lien. Votre ami s\'inscrit et vérifie son email — vous gagnez une récompense !',
    copyLink: 'Copier le lien de parrainage',
    copied: 'Copié !',
    stats: 'Vos parrainages',
    pending: 'En attente',
    paid: 'Payé',
    signInRequired: 'Connectez-vous pour obtenir votre lien de parrainage',
  },
  sw: {
    title: 'Alika & Pata',
    description: 'Shiriki kiungo chako. Rafiki yako anajisajili na kuthibitisha barua pepe — unapata tuzo!',
    copyLink: 'Nakili Kiungo cha Rufaa',
    copied: 'Imekopiwa!',
    stats: 'Rufaa Zako',
    pending: 'Inasubiri',
    paid: 'Imelipwa',
    signInRequired: 'Ingia ili kupata kiungo chako cha rufaa',
  },
  ln: {
    title: 'Benga & Zwa',
    description: 'Kabola lien na yo. Moninga na yo akomi mpe avérifie email — ozwi mbongo!',
    copyLink: 'Kopya lien ya parrainage',
    copied: 'Ekopiami!',
    stats: 'Ba parrainages na yo',
    pending: 'Ezali kozela',
    paid: 'Efutami',
    signInRequired: 'Kota mpo ozwa lien na yo ya parrainage',
  },
};

export function InviteEarn({ language }: InviteEarnProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ pending: 0, paid: 0 });
  const lang = (t as any)[language] || t.en;

  useEffect(() => {
    if (!user) return;

    const loadOrCreateCode = async () => {
      // Try to load existing code
      const { data: existing } = await supabase
        .from('referral_codes')
        .select('code')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        setReferralCode(existing.code);
      } else {
        // Generate a simple code
        const code = user.id.slice(0, 8).toUpperCase();
        const { data: created, error } = await supabase
          .from('referral_codes')
          .insert({ user_id: user.id, code })
          .select('code')
          .single();
        
        if (created) {
          setReferralCode(created.code);
        } else if (error) {
          console.error('Error creating referral code:', error);
        }
      }

      // Load reward stats
      const { data: rewards } = await supabase
        .from('referral_rewards')
        .select('status')
        .eq('referrer_user_id', user.id);
      
      if (rewards) {
        setStats({
          pending: rewards.filter(r => r.status === 'pending').length,
          paid: rewards.filter(r => r.status === 'paid').length,
        });
      }
    };

    loadOrCreateCode();
  }, [user]);

  const handleCopy = async () => {
    if (!referralCode) return;
    const link = `https://afrishop-usa.com/get?ref=${referralCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast({ title: lang.copied });
    setTimeout(() => setCopied(false), 2000);
  };

  if (!user) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-2">
          <Gift className="h-5 w-5 text-orange-400" />
          <span className="text-white font-medium">{lang.title}</span>
        </div>
        <p className="text-white/50 text-sm">{lang.signInRequired}</p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Gift className="h-5 w-5 text-orange-400" />
        <span className="text-white font-medium">{lang.title}</span>
      </div>
      
      <p className="text-white/60 text-sm">{lang.description}</p>

      {referralCode && (
        <Button 
          onClick={handleCopy}
          variant="outline"
          className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
        >
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? lang.copied : lang.copyLink}
        </Button>
      )}

      {(stats.pending > 0 || stats.paid > 0) && (
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-yellow-400">
            <Users className="h-4 w-4" />
            <span>{stats.pending} {lang.pending}</span>
          </div>
          <div className="flex items-center gap-1.5 text-green-400">
            <Users className="h-4 w-4" />
            <span>{stats.paid} {lang.paid}</span>
          </div>
        </div>
      )}
    </div>
  );
}
