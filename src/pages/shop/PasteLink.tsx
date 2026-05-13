import { useState, useRef } from 'react';
import { Link2, Clipboard, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
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
import { SEOHead } from '@/components/SEOHead';

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

      // Even on error, try to extract partial data (title/image) from the response
      if (fnError) {
        // supabase.functions.invoke returns data even on non-2xx if JSON
        const partialTitle = data?.title || extractDomain(trimmed);
        const partialImage = data?.imageUrl || data?.image || null;
        
        if (partialTitle || partialImage) {
          setShowManualPrice(true);
          const store = extractDomain(trimmed);
          const vehicleResult = detectVehicle(trimmed, partialTitle);
          setResult({ title: partialTitle, priceUsd: 0, imageUrl: partialImage, store, vehicleResult });
        } else {
          throw fnError;
        }
        return;
      }

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

  const handleManualPriceSubmit = async () => {
    const price = parseFloat(manualPrice);
    if (!price || price <= 0) return;
    if (result) {
      setResult({ ...result, priceUsd: price });
      setShowManualPrice(false);
      setError(null);

      // Persist manual price to catalog_items so the item is saved
      try {
        await supabase.functions.invoke('extract-price', {
          body: { url: url.trim(), manualPrice: price },
        });
      } catch (e) {
        console.warn('[PasteLink] catalog update with manual price failed (non-blocking):', e);
      }
    }
  };

  return (
    <SEOHead title="Paste a USA Product Link" description="Paste any Amazon, eBay, Walmart or SHEIN URL to get an all-inclusive delivered-to-DRC quote." />
    <div className="min-h-screen bg-[#0f1115] pb-safe-nav">
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
        {/* Simple headline — 2 lines max */}
        <div className="mt-6 mb-5 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {isFr ? 'Collez le lien. On calcule le prix.' : 'Paste the link. We get the price.'}
          </h2>
          <p className="text-sm text-white/50 mt-2 max-w-md mx-auto">
            {isFr
              ? 'Copiez le lien du produit depuis un magasin ci-dessous, collez-le ici.'
              : 'Copy the product link from a store below, paste it here.'}
          </p>
        </div>

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

        {/* Product preview when we have title/image but awaiting price */}
        {result && result.priceUsd === 0 && (result.imageUrl || result.title) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl border border-white/[0.08] bg-[#1a1d23] mb-5"
          >
            <div className="flex items-center gap-4">
              {result.imageUrl && (
                <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 flex-shrink-0">
                  <img
                    src={result.imageUrl}
                    alt={result.title}
                    className="w-full h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{result.title}</p>
                <p className="text-xs text-white/40 mt-1">{result.store}</p>
              </div>
            </div>
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
