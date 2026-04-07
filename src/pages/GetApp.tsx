import { useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/i18n/translations';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { useSupportContact } from '@/hooks/useSupportContact';
import { Globe, MessageCircle } from 'lucide-react';
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
  const { whatsapp } = useSupportContact();

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
    supabase.rpc('validate_ref_code', { code: refCode })
      .maybeSingle()
      .then(({ data: referrer }) => {
        if (referrer && referrer.status !== 'active') return; // Inactive code
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

  const whatsappUrl = `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`;
  const webUrlWithParams = buildUrlWithParams(WEBSITE_URL, params);

  return (
    <div className="min-h-screen bg-[hsl(222,47%,5%)] text-white flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Ambient glow effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-blue-500/12 via-cyan-500/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-blue-400/5 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-[200px] h-[400px] bg-cyan-500/5 rounded-full blur-3xl" />
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
            <div className="absolute -inset-4 bg-gradient-to-br from-blue-500/20 to-cyan-400/10 rounded-[28px] blur-xl" />
            <div className="relative w-28 h-28 rounded-[22px] bg-[hsl(222,30%,10%)] border border-white/[0.08] shadow-2xl shadow-blue-500/10 flex items-center justify-center overflow-hidden">
              <img
                src={afrishopLogo}
                alt="AfriShop"
                className="w-[85%] h-[85%] object-contain brightness-0 invert"
              />
            </div>
          </div>
        </motion.div>

        {/* Title & Subtitle */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="space-y-3"
        >
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-300 via-cyan-300 to-blue-400 bg-clip-text text-transparent">
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
            className="group relative flex items-center justify-center gap-2.5 w-full py-4 px-6 bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-green-500/25 hover:shadow-green-500/40 hover:scale-[1.02] active:scale-[0.98]"
          >
            {/* Android robot icon */}
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85 1.23 12.95 1 12 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31C6.97 3.26 6 5.01 6 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/>
            </svg>
            {dl?.androidButton || 'Download Android App'}
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
