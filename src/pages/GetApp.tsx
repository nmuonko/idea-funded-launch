import { useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/i18n/translations';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { SUPPORT_WHATSAPP_E164 } from '@/lib/supportConfig';
import { Download, Globe, MessageCircle, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import afrishopLogo from '@/assets/afrishop-logo.png';
import { motion } from 'framer-motion';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.afrishop.usadrc';
const WEBSITE_URL = 'https://afrishop-usa.com';
const REF_STORAGE_KEY = 'afrishop_ref_code';
const REF_CLICK_SESSION_KEY = 'afrishop_ref_click_sent';

function getQueryParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function buildUrlWithParams(baseUrl: string, params: URLSearchParams): string {
  const relevantKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];
  const filtered = new URLSearchParams();
  relevantKeys.forEach(key => {
    const val = params.get(key);
    if (val) filtered.set(key, val);
  });
  const qs = filtered.toString();
  return qs ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${qs}` : baseUrl;
}

export default function GetApp() {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const dl = (t as any).download;
  const params = useMemo(() => getQueryParams(), []);
  const refCode = params.get('ref');

  // Store ref code in localStorage for 30 days
  useEffect(() => {
    if (refCode) {
      const data = { code: refCode, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 };
      localStorage.setItem(REF_STORAGE_KEY, JSON.stringify(data));
    }
  }, [refCode]);

  // Track referral click (dedupe per session, validate ref_code exists in referrers)
  useEffect(() => {
    if (!refCode) return;
    const sessionKey = `${REF_CLICK_SESSION_KEY}_${refCode}`;
    if (sessionStorage.getItem(sessionKey)) return;

    const anonSessionId = crypto.randomUUID();
    
    // Validate code exists in referrers and is active, then log click
    supabase.from('referrers')
      .select('id, status')
      .eq('ref_code', refCode)
      .eq('status', 'active')
      .maybeSingle()
      .then(({ data: referrer }) => {
        if (!referrer) return; // Invalid or inactive code
        
        supabase.from('referral_events').insert({
          ref_code: refCode,
          event_type: 'click',
          anon_session_id: anonSessionId,
          meta: {
            user_agent: navigator.userAgent,
            referrer: document.referrer || null,
            utm_source: params.get('utm_source'),
            utm_medium: params.get('utm_medium'),
            utm_campaign: params.get('utm_campaign'),
          },
        }).then(() => {
          sessionStorage.setItem(sessionKey, '1');
        });
      });
  }, [refCode, params]);

  // SEO: update title and meta description
  useEffect(() => {
    document.title = dl?.pageTitle || 'Download AfriShop';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute('content', dl?.metaDescription || '');
    } else {
      const newMeta = document.createElement('meta');
      newMeta.name = 'description';
      newMeta.content = dl?.metaDescription || '';
      document.head.appendChild(newMeta);
    }
  }, [dl]);

  const whatsappUrl = `https://wa.me/${SUPPORT_WHATSAPP_E164}`;
  const webUrlWithParams = buildUrlWithParams(WEBSITE_URL, params);

  return (
    <div className="min-h-screen bg-[hsl(222,47%,5%)] text-white flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Ambient glow effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-orange-500/12 via-yellow-500/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-[200px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
      </div>

      {/* Floating language switcher */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="w-full max-w-sm space-y-8 text-center relative z-10"
      >
        {/* Logo with glow ring */}
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex justify-center"
        >
          <div className="relative">
            <div className="absolute -inset-3 bg-gradient-to-br from-orange-500/20 to-yellow-500/10 rounded-3xl blur-xl" />
            <img
              src={afrishopLogo}
              alt="AfriShop"
              className="relative w-24 h-24 rounded-2xl shadow-2xl shadow-orange-500/10 brightness-0 invert"
            />
          </div>
        </motion.div>

        {/* Title & Subtitle */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="space-y-3"
        >
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-orange-300 via-yellow-300 to-orange-400 bg-clip-text text-transparent">
            {dl?.title || 'Get AfriShop'}
          </h1>
          <p className="text-white/50 text-base sm:text-lg leading-relaxed">
            {dl?.subtitle || 'Shop from the USA, deliver to Africa'}
          </p>
        </motion.div>

        {/* Action Buttons */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="space-y-3 pt-2"
        >
          <a
            href={PLAY_STORE_URL}
            className="group relative flex items-center justify-center gap-2.5 w-full py-4 px-6 bg-gradient-to-r from-orange-500 to-yellow-500 text-black font-bold rounded-2xl transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Download className="w-5 h-5" />
            {dl?.androidButton || 'Download Android App'}
            <Sparkles className="w-4 h-4 opacity-60" />
          </a>

          <a
            href={webUrlWithParams}
            className="flex items-center justify-center gap-2.5 w-full py-4 px-6 bg-white/[0.06] border border-white/[0.1] text-white/90 font-semibold rounded-2xl hover:bg-white/[0.1] hover:border-white/[0.15] transition-all hover:scale-[1.02] active:scale-[0.98] backdrop-blur-sm"
          >
            <Globe className="w-5 h-5 text-white/60" />
            {dl?.webButton || 'Open the Website'}
          </a>
        </motion.div>

        {/* Helper text */}
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-white/30 text-sm"
        >
          {dl?.helper || 'You can choose the app or the website.'}
        </motion.p>

        {/* Support section */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="pt-6 border-t border-white/[0.06] space-y-3"
        >
          <p className="text-white/25 text-xs uppercase tracking-[0.2em] font-medium">
            {dl?.supportTitle || 'Help / Support'}
          </p>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-emerald-400/80 hover:text-emerald-300 text-sm transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            {dl?.whatsapp || 'Contact on WhatsApp'}
          </a>
        </motion.div>
      </motion.div>
    </div>
  );
}
