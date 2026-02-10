import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/i18n/translations';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { SUPPORT_WHATSAPP_E164 } from '@/lib/supportConfig';
import { Download, Globe, MessageCircle, Smartphone } from 'lucide-react';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.afrishop.usadrc';
const WEBSITE_URL = 'https://afrishop-usa.com';

export default function GetApp() {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const dl = (t as any).download;

  const isAndroid = /android/i.test(navigator.userAgent);
  const [countdown, setCountdown] = useState(isAndroid ? 2 : -1);
  const [cancelled, setCancelled] = useState(false);

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

  // Android auto-redirect countdown
  useEffect(() => {
    if (!isAndroid || cancelled || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isAndroid, cancelled, countdown]);

  useEffect(() => {
    if (isAndroid && !cancelled && countdown === 0) {
      window.location.href = PLAY_STORE_URL;
    }
  }, [countdown, cancelled, isAndroid]);

  const handleCancel = useCallback(() => {
    setCancelled(true);
    setCountdown(-1);
  }, []);

  const whatsappUrl = `https://wa.me/${SUPPORT_WHATSAPP_E164}`;

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

        {/* Android auto-redirect notice */}
        {isAndroid && !cancelled && countdown > 0 && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 space-y-2">
            <p className="text-orange-300 text-sm font-medium">
              <Smartphone className="inline w-4 h-4 mr-1 -mt-0.5" />
              {(dl?.redirecting || 'Redirecting to Google Play in {seconds}s...').replace('{seconds}', String(countdown))}
            </p>
            <button
              onClick={handleCancel}
              className="text-orange-400 underline text-sm hover:text-orange-300 transition-colors"
            >
              {dl?.cancelRedirect || 'Cancel redirect'}
            </button>
          </div>
        )}

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
            href={WEBSITE_URL}
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
