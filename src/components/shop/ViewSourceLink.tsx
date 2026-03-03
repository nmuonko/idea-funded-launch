import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface ViewSourceLinkProps {
  productUrl: string;
  provider?: string;
  title?: string;
  className?: string;
}

export function ViewSourceLink({ productUrl, provider, title, className }: ViewSourceLinkProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  const isAmazon = provider === 'amazon' || provider === 'rainforest' ||
    (productUrl && productUrl.includes('amazon.com'));

  // For Amazon/Rainforest, use search URL so customers always land on results
  const resolvedUrl = isAmazon && title
    ? `https://www.amazon.com/s?k=${encodeURIComponent(title)}`
    : productUrl;

  const getStoreName = () => {
    if (isAmazon) return 'Amazon';
    if (provider) return provider.charAt(0).toUpperCase() + provider.slice(1);
    try {
      const url = new URL(productUrl);
      if (url.hostname.includes('ebay')) return 'eBay';
      return url.hostname.replace('www.', '');
    } catch {
      return 'Store';
    }
  };

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors ${className}`}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span>
        {shop.viewOn || 'View on'} {getStoreName()}
      </span>
    </a>
  );
}
