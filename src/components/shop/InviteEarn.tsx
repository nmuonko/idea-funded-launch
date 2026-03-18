import { useState } from 'react';
import { Gift, Copy, Check, Loader2, User, Mail, Phone, Sparkles, Share2 } from 'lucide-react';
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
    subtitle: 'Turn your network into income',
    description: 'Register, share your link. When your friend makes a purchase — you earn a commission!',
    copyLink: 'Copy Referral Link',
    copied: 'Copied!',
    register: 'Get My Link',
    namePlaceholder: 'Full name',
    emailPlaceholder: 'Email',
    phonePlaceholder: 'Phone number',
    shareTitle: 'Your referral link',
    shareVia: 'Share via',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: '𝕏 / Twitter',
    telegram: 'Telegram',
    shareMsg: 'Shop African products delivered worldwide on AfriShop USA! Use my referral link:',
    step1: 'Sign up here',
    step2: 'Share your unique link',
    step3: 'Earn on every purchase',
  },
  fr: {
    title: 'Partager & Gagner',
    subtitle: 'Transformez votre réseau en revenus',
    description: 'Inscrivez-vous, partagez votre lien. Quand votre ami achète — vous gagnez une commission !',
    copyLink: 'Copier le lien de parrainage',
    copied: 'Copié !',
    register: 'Obtenir mon lien',
    namePlaceholder: 'Nom complet',
    emailPlaceholder: 'Email',
    phonePlaceholder: 'Numéro de téléphone',
    shareTitle: 'Votre lien de parrainage',
    shareVia: 'Partager via',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: '𝕏 / Twitter',
    telegram: 'Telegram',
    shareMsg: 'Achetez des produits africains livrés partout dans le monde sur AfriShop USA ! Utilisez mon lien :',
    step1: 'Inscrivez-vous ici',
    step2: 'Partagez votre lien unique',
    step3: 'Gagnez à chaque achat',
  },
  sw: {
    title: 'Shiriki & Pata',
    subtitle: 'Geuza mtandao wako kuwa mapato',
    description: 'Jisajili, shiriki kiungo chako. Rafiki yako anaponunua — unapata kamisheni!',
    copyLink: 'Nakili Kiungo cha Rufaa',
    copied: 'Imekopiwa!',
    register: 'Pata Kiungo Changu',
    namePlaceholder: 'Jina kamili',
    emailPlaceholder: 'Barua pepe',
    phonePlaceholder: 'Simu',
    shareTitle: 'Kiungo chako cha rufaa',
    shareVia: 'Shiriki kupitia',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: '𝕏 / Twitter',
    telegram: 'Telegram',
    shareMsg: 'Nunua bidhaa za Kiafrika zinazotumwa duniani kote kwenye AfriShop USA! Tumia kiungo changu:',
    step1: 'Jisajili hapa',
    step2: 'Shiriki kiungo chako',
    step3: 'Pata kwa kila ununuzi',
  },
  ln: {
    title: 'Kabola & Zwa',
    subtitle: 'Bobongola réseau na bino mbongo',
    description: 'Komisa nkombo, kabola lien na yo. Moninga na yo asombi — ozwi commission!',
    copyLink: 'Kopya lien ya parrainage',
    copied: 'Ekopiami!',
    register: 'Kozwa lien na ngai',
    namePlaceholder: 'Nkombo mobimba',
    emailPlaceholder: 'Email',
    phonePlaceholder: 'Telefone',
    shareTitle: 'Lien na yo ya parrainage',
    shareVia: 'Kabola na',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: '𝕏 / Twitter',
    telegram: 'Telegram',
    shareMsg: 'Somba biloko ya Afrika na AfriShop USA! Salelá lien na ngai:',
    step1: 'Komisa nkombo awa',
    step2: 'Kabola lien na yo',
    step3: 'Zwa na mosombi nyonso',
  },
};

const REF_CODE_KEY = 'afrishop_referrer_ref_code';

// Social share helpers
const buildLink = (code: string) => `https://afrishop-usa.com/get?ref=${code}`;

const shareWhatsApp = (msg: string, link: string) =>
  `https://wa.me/?text=${encodeURIComponent(msg + ' ' + link)}`;
const shareFacebook = (link: string) =>
  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;
const shareTwitter = (msg: string, link: string) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(link)}`;
const shareTelegram = (msg: string, link: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(msg)}`;

const socialButtons = [
  { key: 'whatsapp', fn: shareWhatsApp, color: 'bg-[#25D366]', icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.019-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )},
  { key: 'facebook', fn: (_: string, link: string) => shareFacebook(link), color: 'bg-[#1877F2]', icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )},
  { key: 'twitter', fn: shareTwitter, color: 'bg-black', icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  )},
  { key: 'telegram', fn: shareTelegram, color: 'bg-[#0088cc]', icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  )},
];

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
    const link = buildLink(refCode);
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast({ title: lang.copied });
    setTimeout(() => setCopied(false), 2000);
  };

  const link = refCode ? buildLink(refCode) : '';

  return (
    <div className="overflow-hidden rounded-2xl shadow-2xl">
      {/* Hero header with rich gradient */}
      <div className="relative bg-gradient-to-br from-orange-600 via-orange-500 to-amber-400 px-6 pt-10 pb-8 text-center overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 left-8 h-24 w-24 rounded-full border-2 border-white" />
          <div className="absolute bottom-2 right-6 h-16 w-16 rounded-full border-2 border-white" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-40 w-40 rounded-full border border-white/50" />
        </div>

        <Sparkles className="absolute top-4 right-5 h-5 w-5 text-yellow-200/60 animate-pulse" />
        <Sparkles className="absolute bottom-6 left-6 h-4 w-4 text-white/40 animate-pulse [animation-delay:0.7s]" />

        <div className="relative z-10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm shadow-lg border border-white/20">
            <Gift className="h-8 w-8 text-white drop-shadow" />
          </div>
          <h3 className="text-2xl font-extrabold text-white tracking-tight drop-shadow-sm">{lang.title}</h3>
          <p className="mt-1 text-sm font-medium text-white/90">{lang.subtitle}</p>
          <p className="mt-3 text-sm text-white/75 max-w-[300px] mx-auto leading-relaxed">
            {lang.description}
          </p>
        </div>

        {/* Steps indicator */}
        {!refCode && (
          <div className="relative z-10 mt-6 flex justify-center gap-3">
            {[lang.step1, lang.step2, lang.step3].map((step, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/25 text-xs font-bold text-white backdrop-blur-sm border border-white/20">
                  {i + 1}
                </div>
                <span className="text-[10px] text-white/70 font-medium max-w-[72px] text-center leading-tight">{step}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="bg-[hsl(var(--card))] p-5">
        {refCode ? (
          <div className="space-y-5">
            {/* Link display */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {lang.shareTitle}
              </p>
              <div className="relative rounded-xl p-[1.5px] bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-400">
                <div className="rounded-xl bg-[hsl(var(--card))] px-4 py-3.5">
                  <p className="text-sm font-mono text-orange-400 break-all leading-relaxed select-all">
                    {link}
                  </p>
                </div>
              </div>
            </div>

            {/* Copy button */}
            <Button
              onClick={handleCopy}
              className={`w-full h-12 rounded-xl text-base font-semibold transition-all duration-300 ${
                copied
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-lg shadow-orange-500/25'
              }`}
            >
              {copied ? <Check className="h-5 w-5 mr-2" /> : <Copy className="h-5 w-5 mr-2" />}
              {copied ? lang.copied : lang.copyLink}
            </Button>

            {/* Social share buttons */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" />
                {lang.shareVia}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {socialButtons.map(({ key, fn, color, icon }) => (
                  <a
                    key={key}
                    href={fn(lang.shareMsg, link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${color} flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 text-white transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-95`}
                  >
                    {icon}
                    <span className="text-[10px] font-medium opacity-90">{(lang as any)[key]}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Name */}
            <div className="relative group">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-orange-500" />
              <Input
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder={lang.namePlaceholder}
                className="pl-11 h-12 rounded-xl bg-muted/40 border-border/40 focus:border-orange-400 focus:ring-1 focus:ring-orange-400/20 transition-all text-sm"
              />
            </div>

            {/* Email */}
            <div className="relative group">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-orange-500" />
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder={lang.emailPlaceholder}
                className="pl-11 h-12 rounded-xl bg-muted/40 border-border/40 focus:border-orange-400 focus:ring-1 focus:ring-orange-400/20 transition-all text-sm"
              />
            </div>

            {/* Phone */}
            <div className="relative group">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-orange-500" />
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder={lang.phonePlaceholder}
                className="pl-11 h-12 rounded-xl bg-muted/40 border-border/40 focus:border-orange-400 focus:ring-1 focus:ring-orange-400/20 transition-all text-sm"
              />
            </div>

            <Button
              onClick={handleRegister}
              disabled={loading}
              className="w-full h-13 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-base shadow-lg shadow-orange-500/25 transition-all duration-300 mt-2 active:scale-[0.98]"
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
