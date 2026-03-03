import { useState, useRef } from 'react';
import { Link2, Clipboard, Loader2, AlertCircle, ArrowLeft, Sparkles, Globe, Truck } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { SupportedStoresGrid } from '@/components/shop/SupportedStoresGrid';
import { PasteBreakdownCard } from '@/components/shop/PasteBreakdownCard';
import { detectVehicle, VehicleDetectionResult } from '@/lib/vehicleDetection';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';

interface ScrapeResult {
  title: string;
  priceUsd: number;
  imageUrl: string | null;
  store: string;
  vehicleResult: VehicleDetectionResult;
}

export default function PasteLink() {
  const { language } = useLanguage();
  const isFr = language === 'fr';
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [manualPrice, setManualPrice] = useState('');
  const [showManualPrice, setShowManualPrice] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
        setError(null);
        setResult(null);
      }
    } catch {
      // Clipboard API may be blocked
    }
  };

  const extractDomain = (urlStr: string): string => {
    try {
      const hostname = new URL(urlStr).hostname;
      return hostname.replace('www.', '');
    } catch {
      return 'unknown';
    }
  };

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
    } catch {
      setError(isFr ? 'Veuillez entrer un lien valide' : 'Please enter a valid URL');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setShowManualPrice(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('extract-price', {
        body: { url: trimmed },
      });
      if (fnError) throw fnError;

      const priceUsd = data?.basePrice ?? data?.price ?? data?.priceUsd ?? null;
      const title = data?.title || extractDomain(trimmed);
      const imageUrl = data?.image || data?.imageUrl || null;
      const store = extractDomain(trimmed);
      const vehicleResult = detectVehicle(trimmed, title);

      if (priceUsd && priceUsd > 0) {
        setResult({ title, priceUsd, imageUrl, store, vehicleResult });
      } else {
        setShowManualPrice(true);
        setResult({ title, priceUsd: 0, imageUrl, store, vehicleResult });
      }
    } catch (err: any) {
      console.error('[PasteLink] extraction failed:', err);
      setError(
        isFr
          ? "Impossible d'extraire le prix. Essayez un autre lien ou entrez le prix manuellement."
          : 'Could not extract price. Try another link or enter the price manually.'
      );
      setShowManualPrice(true);
      const store = extractDomain(trimmed);
      const vehicleResult = detectVehicle(trimmed);
      setResult({ title: store, priceUsd: 0, imageUrl: null, store, vehicleResult });
    } finally {
      setLoading(false);
    }
  };

  const handleManualPriceSubmit = () => {
    const price = parseFloat(manualPrice);
    if (!price || price <= 0) return;
    if (result) {
      setResult({ ...result, priceUsd: price });
      setShowManualPrice(false);
      setError(null);
    }
  };

  const steps = isFr
    ? [
        { icon: Globe, text: 'Trouvez un produit sur n\'importe quel site' },
        { icon: Clipboard, text: 'Copiez le lien du produit' },
        { icon: Truck, text: 'On calcule le prix livré en RDC' },
      ]
    : [
        { icon: Globe, text: 'Find a product on any website' },
        { icon: Clipboard, text: 'Copy the product link' },
        { icon: Truck, text: 'We calculate the price delivered to DRC' },
      ];

  return (
    <div className="min-h-screen bg-[#0f1115] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f1115]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Link to="/" className="text-white/50 hover:text-white transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <Link2 className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-base font-semibold text-white">
              {isFr ? 'Coller un lien' : 'Paste a Link'}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative mt-6 mb-8"
        >
          {/* Glow */}
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-80 h-40 bg-primary/8 rounded-full blur-3xl pointer-events-none" />

          <div className="relative text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-4">
              <Sparkles className="h-3 w-3" />
              {isFr ? 'Achetez depuis n\'importe quel site' : 'Shop from any website'}
            </div>

            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3 tracking-tight leading-tight">
              {isFr ? 'Collez un lien. On livre.' : 'Paste a link. We deliver.'}
            </h2>
            <p className="text-base sm:text-lg text-white/70 max-w-lg mx-auto font-medium leading-relaxed">
              {isFr
                ? 'Copiez le lien du produit → Collez-le ici → Recevez le prix livré en RDC.'
                : 'Copy the product link → Paste it here → Get the price delivered to DRC.'}
            </p>
          </div>

          {/* Steps */}
          <div className="flex items-center justify-center gap-2 sm:gap-4 mt-6">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 sm:gap-3">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-xs sm:text-sm text-white/60 font-medium text-center leading-tight max-w-[90px] sm:max-w-[120px]">
                    {step.text}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className="w-6 sm:w-10 h-px bg-white/10 mt-[-18px]" />
                )}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Input Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="relative rounded-2xl border border-white/[0.08] bg-[#1a1d23] p-4 sm:p-5 mb-6 shadow-xl shadow-black/20"
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                  setResult(null);
                }}
                placeholder={isFr ? 'https://www.amazon.com/dp/...' : 'https://www.amazon.com/dp/...'}
                className="pr-10 bg-white/[0.04] border-white/[0.08] h-12 text-sm text-white placeholder:text-white/25 focus:border-primary/50 focus:ring-primary/20"
              />
              <button
                onClick={handlePaste}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/30 hover:text-primary hover:bg-primary/10 transition-all"
                title={isFr ? 'Coller' : 'Paste'}
              >
                <Clipboard className="h-4 w-4" />
              </button>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={loading || !url.trim()}
              className="h-12 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20 disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                isFr ? 'Calculer' : 'Get Price'
              )}
            </Button>
          </div>

          {/* Loading state with animation */}
          {loading && (
            <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-xs text-white/50">
                {isFr ? 'Extraction du prix en cours...' : 'Extracting price...'}
              </p>
            </div>
          )}
        </motion.div>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-5"
          >
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </motion.div>
        )}

        {/* Manual price input */}
        {showManualPrice && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl border border-white/[0.08] bg-[#1a1d23] mb-5"
          >
            <p className="text-sm text-white/50 mb-3">
              {isFr ? 'Entrez le prix du produit en USD :' : 'Enter the product price in USD:'}
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 font-medium">$</span>
                <Input
                  type="number"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20"
                  min="0"
                  step="0.01"
                />
              </div>
              <Button
                onClick={handleManualPriceSubmit}
                disabled={!manualPrice || parseFloat(manualPrice) <= 0}
                className="bg-primary hover:bg-primary/90"
              >
                {isFr ? 'Valider' : 'Apply'}
              </Button>
            </div>
          </motion.div>
        )}

        {/* Result breakdown */}
        {result && result.priceUsd > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <PasteBreakdownCard
              productTitle={result.title}
              productImageUrl={result.imageUrl}
              basePriceUsd={result.priceUsd}
              productUrl={url.trim()}
              store={result.store}
              vehicleResult={result.vehicleResult}
            />
          </motion.div>
        )}

        {/* Supported stores */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <SupportedStoresGrid />
        </motion.div>
      </main>

      <BottomNavigation />
    </div>
  );
}
