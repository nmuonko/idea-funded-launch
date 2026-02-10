import { useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/i18n/translations';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { SUPPORT_WHATSAPP_E164 } from '@/lib/supportConfig';
import { Download, Globe, MessageCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

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

  // Track referral click (dedupe per session)
  useEffect(() => {
    if (!refCode) return;
    const sessionKey = `${REF_CLICK_SESSION_KEY}_${refCode}`;
    if (sessionStorage.getItem(sessionKey)) return;
    
    // Fire-and-forget click event
    supabase.from('referral_events').insert({
      ref_code: refCode,
      event_type: 'click',
      session_id: crypto.randomUUID(),
      metadata: {
        user_agent: navigator.userAgent,
        referrer: document.referrer || null,
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
      },
    }).then(() => {
      sessionStorage.setItem(sessionKey, '1');
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
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4 py-8 relative">
      {/* Floating language switcher */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md space-y-8 text-center">
        {/* Logo */}
        <div className="flex justify-center">
          <img
            src="/favicon.png"
            alt="AfriShop"
            className="w-20 h-20 rounded-2xl shadow-lg"
          />
        </div>

        {/* Title & Subtitle */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent">
            {dl?.title || 'Get AfriShop'}
          </h1>
          <p className="text-gray-400 text-lg">
            {dl?.subtitle || 'Shop from the USA, deliver to Africa'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <a
            href={PLAY_STORE_URL}
            className="flex items-center justify-center gap-2 w-full py-3.5 px-6 bg-gradient-to-r from-orange-500 to-yellow-500 text-black font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg shadow-orange-500/20"
          >
            <Download className="w-5 h-5" />
            {dl?.androidButton || 'Download Android App'}
          </a>

          <a
            href={webUrlWithParams}
            className="flex items-center justify-center gap-2 w-full py-3.5 px-6 border border-gray-600 text-gray-200 font-medium rounded-xl hover:bg-white/5 transition-all"
          >
            <Globe className="w-5 h-5" />
            {dl?.webButton || 'Open the Website'}
          </a>
        </div>

        {/* Helper text */}
        <p className="text-gray-500 text-sm">
          {dl?.helper || 'You can choose the app or the website.'}
        </p>

        {/* Support section */}
        <div className="pt-4 border-t border-gray-800 space-y-3">
          <p className="text-gray-500 text-xs uppercase tracking-wider">
            {dl?.supportTitle || 'Help / Support'}
          </p>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-green-400 hover:text-green-300 text-sm transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            {dl?.whatsapp || 'Contact on WhatsApp'}
          </a>
        </div>
      </div>
    </div>
  );
}
