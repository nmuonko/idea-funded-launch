import { useState } from 'react';
import { Gift, Copy, Check, Loader2, User, Mail, Phone, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
      const { data, error } = await supabase.functions.invoke('auth-service', {
        body: { action: 'create_referrer', full_name: form.full_name, email: form.email, phone: form.phone },
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
    <div className="overflow-hidden rounded-2xl">
      {/* Gradient Header */}
      <div className="relative bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-400 px-6 py-8 text-center overflow-hidden">
        {/* Decorative sparkles */}
        <Sparkles className="absolute top-3 right-4 h-5 w-5 text-white/40 animate-pulse" />
        <Sparkles className="absolute bottom-4 left-5 h-4 w-4 text-white/30 animate-pulse [animation-delay:0.5s]" />
        <Sparkles className="absolute top-6 left-10 h-3 w-3 text-yellow-200/50 animate-pulse [animation-delay:1s]" />

        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
          <Gift className="h-7 w-7 text-white" />
        </div>
        <h3 className="text-xl font-bold text-white tracking-tight">{lang.title}</h3>
        <p className="mt-2 text-sm text-white/80 max-w-[280px] mx-auto leading-relaxed">
          {lang.description}
        </p>
      </div>

      {/* Content */}
      <div className="bg-[hsl(var(--background))]/95 backdrop-blur-md p-5">
        {refCode ? (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {lang.shareTitle}
            </p>

            {/* Link card with gradient border */}
            <div className="relative rounded-xl p-[1px] bg-gradient-to-r from-orange-500 to-yellow-400">
              <div className="rounded-xl bg-[hsl(var(--background))] px-4 py-3">
                <p className="text-sm font-mono text-orange-400 break-all leading-relaxed">
                  https://afrishop-usa.com/get?ref={refCode}
                </p>
              </div>
            </div>

            <Button
              onClick={handleCopy}
              className={`w-full h-12 rounded-full text-base font-semibold transition-all duration-300 ${
                copied
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white shadow-[0_0_20px_rgba(249,115,22,0.3)]'
              }`}
            >
              {copied ? <Check className="h-5 w-5 mr-2" /> : <Copy className="h-5 w-5 mr-2" />}
              {copied ? lang.copied : lang.copyLink}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Name */}
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder={lang.namePlaceholder}
                className="pl-10 h-11 rounded-xl bg-muted/50 border-border/50 focus:border-orange-400 transition-colors"
              />
            </div>

            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder={lang.emailPlaceholder}
                className="pl-10 h-11 rounded-xl bg-muted/50 border-border/50 focus:border-orange-400 transition-colors"
              />
            </div>

            {/* Phone */}
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder={lang.phonePlaceholder}
                className="pl-10 h-11 rounded-xl bg-muted/50 border-border/50 focus:border-orange-400 transition-colors"
              />
            </div>

            <Button
              onClick={handleRegister}
              disabled={loading}
              className="w-full h-12 rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white font-semibold text-base shadow-[0_0_20px_rgba(249,115,22,0.3)] transition-all duration-300 mt-1"
            >
              {loading ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Gift className="h-5 w-5 mr-2" />}
              {lang.register}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
