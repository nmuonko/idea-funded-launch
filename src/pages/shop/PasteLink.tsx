import { useState, useRef } from 'react';
import { Link2, Clipboard, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
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

    // Basic URL validation
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
        // No price found — offer manual input
        setShowManualPrice(true);
        setResult({ title, priceUsd: 0, imageUrl, store, vehicleResult });
      }
    } catch (err: any) {
      console.error('[PasteLink] extraction failed:', err);
      setError(
        isFr
          ? 'Impossible d\'extraire le prix. Essayez un autre lien ou entrez le prix manuellement.'
          : 'Could not extract price. Try another link or enter the price manually.'
      );
      setShowManualPrice(true);
      // Still detect vehicle from URL alone
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

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-lg border-b border-border/50">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">
              {isFr ? 'Coller un lien' : 'Paste a Link'}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        {/* Description */}
        <p className="text-sm text-muted-foreground mb-6">
          {isFr
            ? 'Collez le lien d\'un produit de n\'importe quel magasin en ligne. On calcule le prix total avec livraison en RDC.'
            : 'Paste a product link from any online store. We\'ll calculate the total price with delivery to DRC.'}
        </p>

        {/* URL Input */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Input
              ref={inputRef}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
                setResult(null);
              }}
              placeholder={isFr ? 'Collez le lien du produit ici...' : 'Paste product link here...'}
              className="pr-10 bg-secondary/50 border-border/50 h-12 text-sm"
            />
            <button
              onClick={handlePaste}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title={isFr ? 'Coller' : 'Paste'}
            >
              <Clipboard className="h-4 w-4" />
            </button>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={loading || !url.trim()}
            className="h-12 px-6 bg-primary hover:bg-primary/90"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              isFr ? 'Calculer' : 'Get Price'
            )}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Manual price input */}
        {showManualPrice && (
          <div className="p-4 rounded-xl border border-border/50 bg-card mb-4 animate-in fade-in">
            <p className="text-sm text-muted-foreground mb-3">
              {isFr
                ? 'Entrez le prix du produit en USD :'
                : 'Enter the product price in USD:'}
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 bg-secondary/50 border-border/50"
                  min="0"
                  step="0.01"
                />
              </div>
              <Button onClick={handleManualPriceSubmit} disabled={!manualPrice || parseFloat(manualPrice) <= 0}>
                {isFr ? 'Valider' : 'Apply'}
              </Button>
            </div>
          </div>
        )}

        {/* Result breakdown */}
        {result && result.priceUsd > 0 && (
          <PasteBreakdownCard
            productTitle={result.title}
            productImageUrl={result.imageUrl}
            basePriceUsd={result.priceUsd}
            productUrl={url.trim()}
            store={result.store}
            vehicleResult={result.vehicleResult}
          />
        )}

        {/* Supported stores */}
        <SupportedStoresGrid />
      </main>

      <BottomNavigation />
    </div>
  );
}
