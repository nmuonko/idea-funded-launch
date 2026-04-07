import { useState } from 'react';
import { Gift, Copy, Check, Loader2, User, Mail, Phone, Share2, ArrowRight, DollarSign, Users, TrendingUp } from 'lucide-react';
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
    subtitle: 'Your network, your income.',
    description: 'Share your unique link. When someone you referred makes a purchase, you earn a commission — paid directly to your mobile money.',
    copyLink: 'Copy Link',
    copied: 'Copied!',
    register: 'Get My Referral Link',
    namePlaceholder: 'Full name',
    emailPlaceholder: 'Email address',
    phonePlaceholder: 'Mobile Money number (Airtel / M-Pesa / Orange)',
    shareTitle: 'Your referral link',
    shareVia: 'Share via',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: 'X',
    telegram: 'Telegram',
    shareMsg: 'Shop African products delivered worldwide on AfriShop USA! Use my referral link:',
    shareMsgHot: '🔥 Check out these Hot Products on AfriShop USA — limited deals at amazing prices!',
    howIt: 'How it works',
    step1title: 'Sign Up',
    step1desc: 'Register with your Mobile Money number',
    step2title: 'Share',
    step2desc: 'Send your link to friends',
    step3title: 'Earn',
    step3desc: 'Get paid to your Mobile Money',
    payoutNotice: '💰 Commissions are paid directly to your Mobile Money wallet (Airtel Money, M-Pesa, or Orange Money). Make sure you register with the correct number!',
    alreadyRegistered: 'Already registered?',
    retrieveLink: 'Retrieve my link',
    retrievePlaceholder: 'Enter your email',
    retrieveBtn: 'Find my link',
    noLinkFound: 'No referral link found for this email.',
    backToRegister: 'Back to registration',
  },
  fr: {
    title: 'Partager & Gagner',
    subtitle: 'Votre réseau, vos revenus.',
    description: 'Partagez votre lien unique. Quand un ami achète — vous gagnez une commission versée sur votre mobile money.',
    copyLink: 'Copier le lien',
    copied: 'Copié !',
    register: 'Obtenir mon lien de parrainage',
    namePlaceholder: 'Nom complet',
    emailPlaceholder: 'Adresse email',
    phonePlaceholder: 'Numéro Mobile Money (Airtel / M-Pesa / Orange)',
    shareTitle: 'Votre lien de parrainage',
    shareVia: 'Partager via',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: 'X',
    telegram: 'Telegram',
    shareMsg: 'Achetez des produits africains livrés partout dans le monde sur AfriShop USA ! Utilisez mon lien :',
    shareMsgHot: '🔥 Découvrez les Produits Vedettes sur AfriShop USA — offres limitées à prix incroyables !',
    howIt: 'Comment ça marche',
    step1title: 'Inscrivez-vous',
    step1desc: 'Avec votre numéro Mobile Money',
    step2title: 'Partagez',
    step2desc: 'Envoyez votre lien',
    step3title: 'Gagnez',
    step3desc: 'Recevez sur votre Mobile Money',
    payoutNotice: '💰 Les commissions sont versées directement sur votre Mobile Money (Airtel Money, M-Pesa ou Orange Money). Inscrivez-vous avec le bon numéro !',
    alreadyRegistered: 'Déjà inscrit(e) ?',
    retrieveLink: 'Retrouver mon lien',
    retrievePlaceholder: 'Entrez votre email',
    retrieveBtn: 'Trouver mon lien',
    noLinkFound: 'Aucun lien trouvé pour cet email.',
    backToRegister: "Retour à l'inscription",
  },
  sw: {
    title: 'Shiriki & Pata',
    subtitle: 'Mtandao wako, mapato yako.',
    description: 'Shiriki kiungo chako. Rafiki yako anaponunua — unapata kamisheni kwenye mobile money yako.',
    copyLink: 'Nakili kiungo',
    copied: 'Imekopiwa!',
    register: 'Pata Kiungo Changu',
    namePlaceholder: 'Jina kamili',
    emailPlaceholder: 'Barua pepe',
    phonePlaceholder: 'Nambari ya Mobile Money (Airtel / M-Pesa / Orange)',
    shareTitle: 'Kiungo chako cha rufaa',
    shareVia: 'Shiriki kupitia',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: 'X',
    telegram: 'Telegram',
    shareMsg: 'Nunua bidhaa za Kiafrika kwenye AfriShop USA! Tumia kiungo changu:',
    shareMsgHot: '🔥 Angalia Bidhaa Moto kwenye AfriShop USA — ofa za bei nzuri!',
    howIt: 'Jinsi inavyofanya kazi',
    step1title: 'Jisajili',
    step1desc: 'Kwa nambari yako ya Mobile Money',
    step2title: 'Shiriki',
    step2desc: 'Tuma kiungo chako',
    step3title: 'Pata',
    step3desc: 'Lipa kwenye Mobile Money yako',
    payoutNotice: '💰 Kamisheni zinalipwa moja kwa moja kwenye Mobile Money yako (Airtel Money, M-Pesa au Orange Money). Jisajili na nambari sahihi!',
    alreadyRegistered: 'Tayari umesajiliwa?',
    retrieveLink: 'Pata kiungo changu',
    retrievePlaceholder: 'Ingiza barua pepe yako',
    retrieveBtn: 'Tafuta kiungo changu',
    noLinkFound: 'Hakuna kiungo kilichopatikana kwa barua pepe hii.',
    backToRegister: 'Rudi kwenye usajili',
  },
  ln: {
    title: 'Kabola & Zwa',
    subtitle: 'Réseau na yo, mbongo na yo.',
    description: 'Kabola lien na yo. Moninga na yo asombi — ozwi commission na mobile money na yo.',
    copyLink: 'Kopya lien',
    copied: 'Ekopiami!',
    register: 'Kozwa lien na ngai',
    namePlaceholder: 'Nkombo mobimba',
    emailPlaceholder: 'Email',
    phonePlaceholder: 'Nambala ya Mobile Money (Airtel / M-Pesa / Orange)',
    shareTitle: 'Lien na yo ya parrainage',
    shareVia: 'Kabola na',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter: 'X',
    telegram: 'Telegram',
    shareMsg: 'Somba biloko ya Afrika na AfriShop USA! Salelá lien na ngai:',
    shareMsgHot: '🔥 Talá biloko ya moto na AfriShop USA — mbongo moke, biloko kitoko!',
    howIt: 'Ndenge esalamaka',
    step1title: 'Komisa nkombo',
    step1desc: 'Na nambala na yo ya Mobile Money',
    step2title: 'Kabola',
    step2desc: 'Tindá lien na yo',
    step3title: 'Zwa',
    step3desc: 'Futamá na Mobile Money na yo',
    payoutNotice: '💰 Commission ekofutama na Mobile Money na yo (Airtel Money, M-Pesa to Orange Money). Komisa nkombo na nambala ya solo!',
    alreadyRegistered: 'Osi na nkombo?',
    retrieveLink: 'Kozwa lien na ngai',
    retrievePlaceholder: 'Kotia email na yo',
    retrieveBtn: 'Koluka lien na ngai',
    noLinkFound: 'Lien emonani te na email oyo.',
    backToRegister: 'Kozonga na inscription',
  },
};

const REF_CODE_KEY = 'afrishop_referrer_ref_code';
const buildLink = (code: string) => `https://afrishop-usa.com/get?ref=${code}`;

const shareWhatsApp = (msg: string, link: string) =>
  `https://wa.me/?text=${encodeURIComponent(msg + ' ' + link)}`;
const shareFacebook = (_: string, link: string) =>
  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;
const shareTwitter = (msg: string, link: string) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(link)}`;
const shareTelegram = (msg: string, link: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(msg)}`;

const socialButtons = [
  {
    key: 'whatsapp', fn: shareWhatsApp,
    bg: 'bg-[#25D366]/15 hover:bg-[#25D366]/25',
    iconColor: 'text-[#25D366]',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.019-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    ),
  },
  {
    key: 'facebook', fn: shareFacebook,
    bg: 'bg-[#1877F2]/15 hover:bg-[#1877F2]/25',
    iconColor: 'text-[#1877F2]',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
  },
  {
    key: 'twitter', fn: shareTwitter,
    bg: 'bg-white/10 hover:bg-white/15',
    iconColor: 'text-white',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    key: 'telegram', fn: shareTelegram,
    bg: 'bg-[#0088cc]/15 hover:bg-[#0088cc]/25',
    iconColor: 'text-[#0088cc]',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
      </svg>
    ),
  },
];

export function InviteEarn({ language }: InviteEarnProps) {
  const { toast } = useToast();
  const lang = (t as any)[language] || t.fr;

  const storedCode = (() => {
    try { return localStorage.getItem(REF_CODE_KEY) || null; } catch { return null; }
  })();

  const [refCode, setRefCode] = useState<string | null>(storedCode);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });
  const [mode, setMode] = useState<'register' | 'retrieve'>('register');
  const [retrieveEmail, setRetrieveEmail] = useState('');


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

  const handleRetrieve = async () => {
    if (!retrieveEmail) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('referrers')
        .select('ref_code')
        .eq('email', retrieveEmail.trim().toLowerCase())
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast({ title: lang.noLinkFound, variant: 'destructive' });
        return;
      }
      setRefCode(data.ref_code);
      localStorage.setItem(REF_CODE_KEY, data.ref_code);
      toast({ title: '✓' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!refCode) return;
    await navigator.clipboard.writeText(buildLink(refCode));
    setCopied(true);
    toast({ title: lang.copied });
    setTimeout(() => setCopied(false), 2000);
  };

  const link = refCode ? buildLink(refCode) : '';

  const stepIcons = [
    <Users className="h-5 w-5" />,
    <Share2 className="h-5 w-5" />,
    <DollarSign className="h-5 w-5" />,
  ];

  return (
    <div className="rounded-2xl bg-[#1e2028]">
      {/* ── Header ── */}
      <div className="relative px-6 pt-8 pb-6 text-center">
        {/* Subtle accent glow behind icon */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 h-20 w-20 rounded-full bg-amber-500/10 blur-2xl" />

        <div className="relative z-10">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-white/10">
            <Gift className="h-7 w-7 text-amber-400" />
          </div>
          <h3 className="text-xl font-bold text-white">{lang.title}</h3>
          <p className="text-amber-400/90 text-sm font-medium mt-0.5">{lang.subtitle}</p>
          <p className="mt-2 text-[13px] text-white/50 max-w-[300px] mx-auto leading-relaxed">
            {lang.description}
          </p>
        </div>
      </div>

      {refCode ? (
        /* ── SHARE VIEW ── */
        <div className="px-5 pb-6 space-y-5">
          {/* Link card */}
          <div>
            <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest mb-2">
              {lang.shareTitle}
            </p>
            <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 flex items-center gap-3">
              <p className="text-sm font-mono text-amber-400/90 break-all flex-1 select-all leading-relaxed">
                {link}
              </p>
              <button
                onClick={handleCopy}
                className={`shrink-0 flex items-center justify-center h-9 w-9 rounded-lg transition-all ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-white/10 text-white/60 hover:bg-white/15 hover:text-white'
                }`}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Copy full-width button */}
          <Button
            onClick={handleCopy}
            className={`w-full h-11 rounded-xl text-sm font-semibold transition-all ${
              copied
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-white/10 text-white border border-white/10 hover:bg-white/15'
            }`}
            variant="ghost"
          >
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? lang.copied : lang.copyLink}
          </Button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-[11px] font-semibold text-white/30 uppercase tracking-widest">{lang.shareVia}</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          {/* Social grid */}
          <div className="grid grid-cols-4 gap-2">
            {socialButtons.map(({ key, fn, bg, iconColor, icon }) => (
              <a
                key={key}
                href={fn(shareType === 'hot' ? (lang.shareMsgHot || lang.shareMsg) : lang.shareMsg, link)}
                target="_blank"
                rel="noopener noreferrer"
                className={`${bg} ${iconColor} flex flex-col items-center justify-center gap-1.5 rounded-xl py-3.5 transition-all duration-200 active:scale-95 border border-white/5`}
              >
                {icon}
                <span className="text-[10px] font-medium text-white/50">{(lang as any)[key]}</span>
              </a>
            ))}
          </div>
        </div>
      ) : mode === 'retrieve' ? (
        /* ── RETRIEVE VIEW ── */
        <div className="px-5 pb-6 space-y-4">
          <p className="text-[13px] text-white/50 text-center">{lang.alreadyRegistered}</p>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
            <Input
              type="email"
              value={retrieveEmail}
              onChange={e => setRetrieveEmail(e.target.value)}
              placeholder={lang.retrievePlaceholder}
              className="pl-11 h-11 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 text-sm"
              onKeyDown={e => e.key === 'Enter' && handleRetrieve()}
            />
          </div>
          <Button
            onClick={handleRetrieve}
            disabled={loading || !retrieveEmail}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold text-sm shadow-lg shadow-amber-500/15 transition-all active:scale-[0.98]"
          >
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            {lang.retrieveBtn}
          </Button>
          <button
            onClick={() => setMode('register')}
            className="w-full text-center text-xs text-amber-400/70 hover:text-amber-400 transition-colors py-1"
          >
            {lang.backToRegister}
          </button>
        </div>
      ) : (
        /* ── REGISTRATION VIEW ── */
        <div className="px-5 pb-6 space-y-5">
          {/* Mobile Money payout notice */}
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
            <p className="text-[12px] text-amber-300/90 leading-relaxed font-medium">
              {lang.payoutNotice}
            </p>
            <div className="flex items-center gap-3 mt-2.5">
              <span className="text-[10px] bg-white/10 text-white/70 px-2.5 py-1 rounded-full font-semibold">Airtel Money</span>
              <span className="text-[10px] bg-white/10 text-white/70 px-2.5 py-1 rounded-full font-semibold">M-Pesa</span>
              <span className="text-[10px] bg-white/10 text-white/70 px-2.5 py-1 rounded-full font-semibold">Orange Money</span>
            </div>
          </div>

          {/* How it works */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest mb-3">{lang.howIt}</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { title: lang.step1title, desc: lang.step1desc },
                { title: lang.step2title, desc: lang.step2desc },
                { title: lang.step3title, desc: lang.step3desc },
              ].map((step, i) => (
                <div key={i} className="flex flex-col items-center text-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/10">
                    {stepIcons[i]}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white/80">{step.title}</p>
                    <p className="text-[10px] text-white/40 leading-tight mt-0.5">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <div className="space-y-2.5">
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <Input
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder={lang.namePlaceholder}
                className="pl-11 h-11 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 text-sm"
              />
            </div>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder={lang.emailPlaceholder}
                className="pl-11 h-11 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 text-sm"
              />
            </div>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder={lang.phonePlaceholder}
                className="pl-11 h-11 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 text-sm"
              />
            </div>
          </div>

          <Button
            onClick={handleRegister}
            disabled={loading}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold text-sm shadow-lg shadow-amber-500/15 transition-all active:scale-[0.98]"
          >
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            {lang.register}
          </Button>

          {/* Already registered link */}
          <button
            onClick={() => setMode('retrieve')}
            className="w-full text-center text-xs text-amber-400/70 hover:text-amber-400 transition-colors py-1"
          >
            {lang.alreadyRegistered} <span className="underline">{lang.retrieveLink}</span>
          </button>
        </div>
      )}
    </div>
  );
}
