import { useState } from 'react';
import { Gift, Copy, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface InviteEarnProps {
  language: string;
}

const t = {
  en: {
    title: 'Share & Earn',
    description: 'Register, share your link. When your friend verifies their email — you earn a reward!',
    copyLink: 'Copy Referral Link',
    copied: 'Copied!',
    register: 'Get My Link',
    namePlaceholder: 'Full name',
    emailPlaceholder: 'Email',
    phonePlaceholder: 'Phone',
    shareTitle: 'Your referral link',
  },
  fr: {
    title: 'Partager & Gagner',
    description: 'Inscrivez-vous, partagez votre lien. Quand votre ami vérifie son email — vous gagnez une récompense !',
    copyLink: 'Copier le lien de parrainage',
    copied: 'Copié !',
    register: 'Obtenir mon lien',
    namePlaceholder: 'Nom complet',
    emailPlaceholder: 'Email',
    phonePlaceholder: 'Téléphone',
    shareTitle: 'Votre lien de parrainage',
  },
  sw: {
    title: 'Shiriki & Pata',
    description: 'Jisajili, shiriki kiungo chako. Rafiki yako anapothibitisha barua pepe — unapata tuzo!',
    copyLink: 'Nakili Kiungo cha Rufaa',
    copied: 'Imekopiwa!',
    register: 'Pata Kiungo Changu',
    namePlaceholder: 'Jina kamili',
    emailPlaceholder: 'Barua pepe',
    phonePlaceholder: 'Simu',
    shareTitle: 'Kiungo chako cha rufaa',
  },
  ln: {
    title: 'Kabola & Zwa',
    description: 'Komisa nkombo, kabola lien na yo. Moninga na yo avérifie email — ozwi mbongo!',
    copyLink: 'Kopya lien ya parrainage',
    copied: 'Ekopiami!',
    register: 'Kozwa lien na ngai',
    namePlaceholder: 'Nkombo mobimba',
    emailPlaceholder: 'Email',
    phonePlaceholder: 'Telefone',
    shareTitle: 'Lien na yo ya parrainage',
  },
};

const REF_CODE_KEY = 'afrishop_referrer_ref_code';

export function InviteEarn({ language }: InviteEarnProps) {
  const { toast } = useToast();
  const lang = (t as any)[language] || t.fr;

  // Check if already registered
  const storedCode = (() => {
    try {
      return localStorage.getItem(REF_CODE_KEY) || null;
    } catch { return null; }
  })();

  const [refCode, setRefCode] = useState<string | null>(storedCode);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });

  const handleRegister = async () => {
    if (!form.full_name || !form.email || !form.phone) {
      toast({ title: lang.namePlaceholder + ', ' + lang.emailPlaceholder + ', ' + lang.phonePlaceholder, variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-referrer', {
        body: { full_name: form.full_name, email: form.email, phone: form.phone },
      });
      if (error || !data?.ok) {
        toast({ title: 'Error', description: data?.message || error?.message || 'Failed', variant: 'destructive' });
        return;
      }
      setRefCode(data.ref_code);
      localStorage.setItem(REF_CODE_KEY, data.ref_code);
      toast({ title: lang.copied.replace('!', '') + ' ✓' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!refCode) return;
    const link = `https://afrishop-usa.com/get?ref=${refCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast({ title: lang.copied });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Gift className="h-5 w-5 text-orange-400" />
        <span className="text-white font-medium">{lang.title}</span>
      </div>

      <p className="text-white/60 text-sm">{lang.description}</p>

      {refCode ? (
        <>
          <p className="text-white/40 text-xs">{lang.shareTitle}</p>
          <div className="bg-white/5 rounded-lg px-3 py-2 text-sm text-orange-300 font-mono break-all">
            https://afrishop-usa.com/get?ref={refCode}
          </div>
          <Button
            onClick={handleCopy}
            variant="outline"
            className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
          >
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? lang.copied : lang.copyLink}
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <Label className="text-white/70 text-xs">{lang.namePlaceholder}</Label>
            <Input
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder={lang.namePlaceholder}
              className="bg-white/5 border-white/20 text-white"
            />
          </div>
          <div>
            <Label className="text-white/70 text-xs">{lang.emailPlaceholder}</Label>
            <Input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder={lang.emailPlaceholder}
              className="bg-white/5 border-white/20 text-white"
            />
          </div>
          <div>
            <Label className="text-white/70 text-xs">{lang.phonePlaceholder}</Label>
            <Input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder={lang.phonePlaceholder}
              className="bg-white/5 border-white/20 text-white"
            />
          </div>
          <Button
            onClick={handleRegister}
            disabled={loading}
            className="w-full bg-gradient-to-r from-orange-500 to-yellow-500 text-black font-semibold"
          >
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Gift className="h-4 w-4 mr-2" />}
            {lang.register}
          </Button>
        </div>
      )}
    </div>
  );
}
